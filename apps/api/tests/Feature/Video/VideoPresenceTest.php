<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * GET /api/video/rooms/presence — live occupancy for the classroom panel cards. Verifies the SFU
 * participant list is reduced to per-person camera/mic/screen state + aggregate tallies, that hidden
 * monitors never count as occupants, empty/offline rooms are omitted, and the list is RLS-scoped.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    config([
        'services.livekit.host' => 'wss://media.test',
        'services.livekit.api_url' => 'https://media.test',
        'services.livekit.api_key' => 'devkey',
        'services.livekit.api_secret' => str_repeat('s', 40),
    ]);

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER');
});

/** Seed a room with a known livekit_name (RLS GUCs set for the insert), returning its ids. */
function seedPresenceRoom(string $academyId, string $name = 'Halaqa Live'): array
{
    $id = (string) Str::uuid();
    $livekitName = 'r-'.substr($id, 0, 8).'__'.$academyId;

    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert([
        'id' => $id,
        'academy_id' => $academyId,
        'name' => $name,
        'livekit_name' => $livekitName,
        'join_token' => Str::random(24),
        'host_token' => Str::random(40),
        'monitor_token' => Str::random(40),
        'config' => json_encode([]),
    ]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return ['id' => $id, 'livekit_name' => $livekitName];
}

it('summarizes live occupants with camera/mic/screen state and drops monitors', function () {
    $room = seedPresenceRoom($this->pro);

    Http::fake([
        '*ListRooms' => Http::response(['rooms' => [['name' => $room['livekit_name'], 'numParticipants' => 3]]]),
        '*ListParticipants' => Http::response(['participants' => [
            [
                'identity' => 'host-1',
                'name' => 'Ustadh Ali',
                'state' => 'ACTIVE',
                'joinedAt' => 1000,
                'metadata' => json_encode(['role' => 'host']),
                'tracks' => [
                    ['sid' => 'V1', 'type' => 'VIDEO', 'source' => 'CAMERA', 'muted' => false],
                    ['sid' => 'A1', 'type' => 'AUDIO', 'source' => 'MICROPHONE', 'muted' => false],
                    ['sid' => 'S1', 'type' => 'VIDEO', 'source' => 'SCREEN_SHARE', 'muted' => false],
                ],
            ],
            [
                'identity' => 'guest-2',
                'name' => 'Sara',
                'state' => 'ACTIVE',
                'joinedAt' => 2000,
                'tracks' => [
                    ['sid' => 'V2', 'type' => 'VIDEO', 'source' => 'CAMERA', 'muted' => true],  // camera off
                    ['sid' => 'A2', 'type' => 'AUDIO', 'source' => 'MICROPHONE', 'muted' => false], // mic on
                ],
            ],
            ['identity' => 'mon', 'metadata' => json_encode(['role' => 'monitor'])], // hidden supervisor
        ]]),
        '*' => Http::response([]),
    ]);

    Sanctum::actingAs($this->proOwner);
    $res = $this->getJson('/api/video/rooms/presence')->assertOk();

    $p = $res->json("presence.{$room['id']}");
    expect($p['count'])->toBe(2)            // host + guest; monitor excluded
        ->and($p['camerasOn'])->toBe(1)     // host on, guest camera muted
        ->and($p['micsOn'])->toBe(2)
        ->and($p['screenSharing'])->toBe(1);

    // Host sorts first and carries its track state; monitor is absent from the occupant list.
    expect($p['participants'])->toHaveCount(2)
        ->and($p['participants'][0]['role'])->toBe('host')
        ->and($p['participants'][0]['name'])->toBe('Ustadh Ali')
        ->and($p['participants'][0]['camera'])->toBeTrue()
        ->and($p['participants'][0]['screen'])->toBeTrue()
        ->and($p['participants'][1]['name'])->toBe('Sara')
        ->and($p['participants'][1]['camera'])->toBeFalse();
    expect(collect($p['participants'])->pluck('role'))->not->toContain('monitor');
});

it('omits rooms the SFU reports as empty or offline', function () {
    $room = seedPresenceRoom($this->pro);
    Http::fake([
        '*ListRooms' => Http::response(['rooms' => []]), // nothing live on the SFU
        '*' => Http::response([]),
    ]);

    Sanctum::actingAs($this->proOwner);
    $res = $this->getJson('/api/video/rooms/presence')->assertOk();

    expect($res->json('presence'))->toBe([]);
});

it('is RLS-scoped — never leaks another academy\'s live room', function () {
    $mine = seedPresenceRoom($this->pro, 'Mine');
    $other = createSecondAcademyRoom();

    Http::fake([
        // Both rooms are live on the shared SFU...
        '*ListRooms' => Http::response(['rooms' => [
            ['name' => $mine['livekit_name'], 'numParticipants' => 1],
            ['name' => $other['livekit_name'], 'numParticipants' => 1],
        ]]),
        '*ListParticipants' => Http::response(['participants' => [
            ['identity' => 'someone', 'state' => 'ACTIVE', 'tracks' => []],
        ]]),
        '*' => Http::response([]),
    ]);

    Sanctum::actingAs($this->proOwner);
    $res = $this->getJson('/api/video/rooms/presence')->assertOk();

    // ...but the caller only ever sees their own academy's room.
    expect($res->json("presence.{$mine['id']}"))->not->toBeNull()
        ->and($res->json("presence.{$other['id']}"))->toBeNull();
});

it('requires room.read', function () {
    $noRead = $this->makeUser($this->pro, 'STAFF'); // reception baseline — no room capabilities
    Http::fake(['*' => Http::response([])]);

    Sanctum::actingAs($noRead);
    $this->getJson('/api/video/rooms/presence')->assertForbidden();
});

/** A live room owned by a second PRO academy (for the cross-tenant isolation check). */
function createSecondAcademyRoom(): array
{
    $planId = DB::table('plans')->where('code', 'PRO')->value('id');
    $academyId = test()->createAcademy(overrides: ['plan_id' => $planId]);

    return seedPresenceRoom($academyId, 'Other');
}
