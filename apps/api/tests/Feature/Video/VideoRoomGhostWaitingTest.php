<?php

declare(strict_types=1);

use App\Services\Livekit\Jwt;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Ghost waiting room (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §13). When a monitor-enabled
 * room also has `config.ghost_waiting_room = true`, a monitor/ghost-link entrant no longer joins
 * silently — they knock, and the host admits or denies them (the teacher-consent gate). On admit the
 * knock mints a HIDDEN monitor token (never a visible guest), writes no attendance row, and audits the
 * entry at the moment the observer truly enters. Off (default) preserves the silent-ghost behaviour.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    config([
        'services.livekit.host' => 'wss://media.test',
        'services.livekit.api_url' => 'https://media.test',
        'services.livekit.api_key' => 'devkey',
        'services.livekit.api_secret' => str_repeat('s', 40),
        'services.livekit.token_ttl' => 900,
    ]);

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan, 'subdomain' => 'ghostx']);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER'); // holds room.monitor
});

/**
 * Seed a room with explicit link tokens + config under its academy's RLS context (unique helper name —
 * Pest file-scoped helpers are global).
 *
 * @param  array<string,mixed>  $config
 * @return array{id: string, join_token: string, host_token: string, monitor_token: string, livekit_name: string}
 */
function seedGhostRoom(string $academyId, array $config = []): array
{
    $id = (string) Str::uuid();
    $row = [
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Ghost',
        'livekit_name' => 'r-'.substr($id, 0, 8).'__'.$academyId,
        'join_token' => Str::random(24),
        'host_token' => Str::random(40),
        'monitor_token' => Str::random(40),
        'config' => json_encode($config),
    ];

    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert($row);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return [
        'id' => $id,
        'join_token' => $row['join_token'],
        'host_token' => $row['host_token'],
        'monitor_token' => $row['monitor_token'],
        'livekit_name' => $row['livekit_name'],
    ];
}

// ── the knock state for a ghost ──────────────────────────────────────────────────────
it('an anonymous ghost link entrant knocks instead of getting a token', function () {
    $room = seedGhostRoom($this->pro, ['monitor_enabled' => true, 'ghost_waiting_room' => true]);

    $res = $this->postJson("/api/video/join/{$room['monitor_token']}", ['display_name' => 'Supervisor'])->assertOk();

    expect($res->json('state'))->toBe('knocking');
    expect($res->json('knockToken'))->toBeString()->not->toBeEmpty();
    expect($res->json('token'))->toBeNull(); // no LiveKit token minted yet

    $this->asAcademy($this->pro);
    $knock = DB::table('room_knocks')->where('room_id', $room['id'])->first();
    expect($knock->status)->toBe('PENDING');
    expect($knock->role)->toBe('monitor');
    expect($knock->actor_user_id)->toBeNull();       // anonymous link
    expect($knock->actor_role)->toBe('MONITOR_LINK');

    // No audit + no attendance until admitted.
    expect(DB::table('audit_log')->where('action', 'video_room.monitor_join')->where('entity_id', $room['id'])->count())->toBe(0);
    expect(DB::table('room_participants')->where('room_id', $room['id'])->count())->toBe(0);
});

it('a signed-in supervisor also knocks and records the audit actor', function () {
    $room = seedGhostRoom($this->pro, ['monitor_enabled' => true, 'ghost_waiting_room' => true]);
    Sanctum::actingAs($this->proOwner);

    $this->postJson("/api/video/join/{$room['monitor_token']}")->assertOk()->assertJsonPath('state', 'knocking');

    $this->asAcademy($this->pro);
    $knock = DB::table('room_knocks')->where('room_id', $room['id'])->first();
    expect($knock->role)->toBe('monitor');
    expect($knock->actor_user_id)->toBe((string) $this->proOwner->getKey());
});

// ── admit → hidden monitor token, audited, no attendance ─────────────────────────────
it('admitting a ghost knock mints a hidden monitor token and audits the entry', function () {
    $room = seedGhostRoom($this->pro, ['monitor_enabled' => true, 'ghost_waiting_room' => true]);
    $knockToken = $this->postJson("/api/video/join/{$room['monitor_token']}", ['display_name' => 'Supervisor'])->json('knockToken');

    $this->asAcademy($this->pro);
    $knockId = DB::table('room_knocks')->where('room_id', $room['id'])->value('id');
    $this->clearTenantContext();

    $this->postJson("/api/video/manage/{$room['host_token']}/knocks/{$knockId}", ['decision' => 'admit'])
        ->assertOk()->assertJsonPath('status', 'ADMITTED');

    $res = $this->postJson("/api/video/knock/{$knockToken}")->assertOk();
    expect($res->json('state'))->toBe('admitted');
    expect($res->json('role'))->toBe('monitor');
    expect($res->json('canManage'))->toBeFalse();
    expect($res->json('manageToken'))->toBeNull();

    // The minted token is a HIDDEN, subscribe-only monitor token.
    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['hidden'] ?? false)->toBeTrue();
    expect($claims['video']['canPublish'] ?? true)->toBeFalse();
    expect(json_decode($claims['metadata'], true)['role'])->toBe('monitor');

    // Audited at the admit moment; still no attendance row (a monitor is a ghost).
    $this->asAcademy($this->pro);
    $audit = DB::table('audit_log')->where('action', 'video_room.monitor_join')->where('entity_id', $room['id'])->first();
    expect($audit)->not->toBeNull();
    expect(DB::table('room_participants')->where('room_id', $room['id'])->count())->toBe(0);
});

it('a denied ghost gets no token', function () {
    $room = seedGhostRoom($this->pro, ['monitor_enabled' => true, 'ghost_waiting_room' => true]);
    $knockToken = $this->postJson("/api/video/join/{$room['monitor_token']}", ['display_name' => 'Supervisor'])->json('knockToken');

    $this->asAcademy($this->pro);
    $knockId = DB::table('room_knocks')->where('room_id', $room['id'])->value('id');
    $this->clearTenantContext();

    $this->postJson("/api/video/manage/{$room['host_token']}/knocks/{$knockId}", ['decision' => 'deny'])
        ->assertOk()->assertJsonPath('status', 'DENIED');

    $res = $this->postJson("/api/video/knock/{$knockToken}")->assertOk();
    expect($res->json('state'))->toBe('denied');
    expect($res->json('token'))->toBeNull();
});

// ── the host queue surfaces the ghost's role ─────────────────────────────────────────
it('the host queue tags a ghost knock with the monitor role', function () {
    $room = seedGhostRoom($this->pro, ['monitor_enabled' => true, 'ghost_waiting_room' => true]);
    $this->postJson("/api/video/join/{$room['monitor_token']}", ['display_name' => 'Supervisor']);

    $res = $this->getJson("/api/video/manage/{$room['host_token']}/knocks")->assertOk();
    expect($res->json('knocks'))->toHaveCount(1);
    expect($res->json('knocks.0.role'))->toBe('monitor');
    expect($res->json('knocks.0.displayName'))->toBe('Supervisor');
});

// ── off (default) preserves the silent-ghost behaviour ───────────────────────────────
it('with the ghost waiting room off, a ghost still enters silently', function () {
    $room = seedGhostRoom($this->pro, ['monitor_enabled' => true]); // ghost_waiting_room defaults false

    $res = $this->postJson("/api/video/join/{$room['monitor_token']}", ['display_name' => 'Supervisor'])->assertOk();

    expect($res->json('state'))->toBeNull(); // not knocking
    expect($res->json('role'))->toBe('monitor');
    expect($res->json('token'))->toBeString()->not->toBeEmpty();

    $this->asAcademy($this->pro);
    expect(DB::table('room_knocks')->where('room_id', $room['id'])->count())->toBe(0);
});

// ── monitor gates still apply before the wait ────────────────────────────────────────
it('a ghost waiting room on a non-monitor-enabled room is still rejected', function () {
    $room = seedGhostRoom($this->pro, ['monitor_enabled' => false, 'ghost_waiting_room' => true]);

    $this->postJson("/api/video/join/{$room['monitor_token']}", ['display_name' => 'Supervisor'])
        ->assertStatus(403)->assertJsonPath('code', 'monitor_disabled');

    $this->asAcademy($this->pro);
    expect(DB::table('room_knocks')->where('room_id', $room['id'])->count())->toBe(0);
});
