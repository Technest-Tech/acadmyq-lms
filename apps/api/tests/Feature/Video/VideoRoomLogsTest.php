<?php

declare(strict_types=1);

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
 * S6 — per-room access log (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §15). Covers the access
 * sessions (who/when/duration/ongoing), the activity feed (audit events newest-first), the stats, the
 * room.monitor privacy gate on monitor_join events, and 404 for an unknown room.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->pro = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO'], overrides: ['subdomain' => 'academyx']);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER'); // holds room.monitor
    $this->proTeacher = $this->makeUser($this->pro, 'TEACHER');      // room.read, NOT room.monitor
});

/** Seed a room under its academy's RLS context; returns its id. */
function seedLogRoom(string $academyId): string
{
    $id = (string) Str::uuid();
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert([
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Logs',
        'livekit_name' => 'r-'.substr($id, 0, 8).'__'.$academyId,
        'join_token' => 'halaqa-logs-'.Str::lower(Str::random(5)),
        'config' => json_encode([]),
    ]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return $id;
}

/** Insert a participant (attendance) row under the academy context. */
function seedParticipant(string $academyId, string $roomId, array $overrides = []): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('room_participants')->insert(array_merge([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'room_id' => $roomId,
        'identity' => 'guest-'.Str::lower(Str::random(8)),
        'display_name' => 'Sara',
        'role' => 'PARTICIPANT',
        'joined_at' => now()->subHour(),
        'left_at' => now()->subMinutes(30),
    ], $overrides));
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");
}

/** Insert an audit_log row for the room (RLS insert policy is with-check(true)). */
function seedRoomEvent(string $academyId, string $roomId, string $action, mixed $createdAt = null): void
{
    DB::table('audit_log')->insert([
        'academy_id' => $academyId,
        'actor_user_id' => null,
        'actor_role' => 'ACADEMY_OWNER',
        'action' => $action,
        'entity_type' => 'video_room',
        'entity_id' => $roomId,
        'created_at' => $createdAt ?? now(),
    ]);
}

it('returns access sessions with computed duration + an ongoing flag', function () {
    $room = seedLogRoom($this->pro);
    // A finished 30-minute session, and an ongoing one (no left_at).
    seedParticipant($this->pro, $room, ['joined_at' => now()->subHour(), 'left_at' => now()->subMinutes(30), 'display_name' => 'Sara']);
    seedParticipant($this->pro, $room, ['joined_at' => now()->subMinutes(10), 'left_at' => null, 'display_name' => 'Omar', 'role' => 'HOST']);

    Sanctum::actingAs($this->proOwner);
    $res = $this->getJson("/api/video/rooms/{$room}/logs")->assertOk();

    expect($res->json('sessions'))->toHaveCount(2);
    expect($res->json('stats.total_sessions'))->toBe(2);
    expect($res->json('stats.unique_participants'))->toBe(2);

    // Newest-first: the ongoing session leads.
    $ongoing = $res->json('sessions.0');
    expect($ongoing['ongoing'])->toBeTrue();
    expect($ongoing['duration_s'])->toBeNull();

    $finished = $res->json('sessions.1');
    expect($finished['ongoing'])->toBeFalse();
    expect($finished['duration_s'])->toBeGreaterThanOrEqual(1790)->toBeLessThanOrEqual(1810); // ~1800s
});

it('returns the room activity feed newest-first', function () {
    $room = seedLogRoom($this->pro);
    seedRoomEvent($this->pro, $room, 'video_room.create', now()->subDay());
    seedRoomEvent($this->pro, $room, 'video_room.update', now()->subMinutes(5));

    Sanctum::actingAs($this->proOwner);
    $events = $this->getJson("/api/video/rooms/{$room}/logs")->assertOk()->json('events');

    expect(collect($events)->pluck('action')->all())->toBe(['video_room.update', 'video_room.create']);
});

it('hides monitor_join events from a non-monitor, shows them to a room.monitor holder', function () {
    $room = seedLogRoom($this->pro);
    seedRoomEvent($this->pro, $room, 'video_room.monitor_join');

    // Teacher holds room.read but NOT room.monitor → the covert entry is stripped.
    Sanctum::actingAs($this->proTeacher);
    $teacherEvents = $this->getJson("/api/video/rooms/{$room}/logs")->assertOk()->json('events');
    expect(collect($teacherEvents)->pluck('action'))->not->toContain('video_room.monitor_join');

    // Owner holds room.monitor → sees it.
    Sanctum::actingAs($this->proOwner);
    $ownerEvents = $this->getJson("/api/video/rooms/{$room}/logs")->assertOk()->json('events');
    expect(collect($ownerEvents)->pluck('action'))->toContain('video_room.monitor_join');
});

it('returns 404 for an unknown room', function () {
    Sanctum::actingAs($this->proOwner);
    $this->getJson('/api/video/rooms/'.Str::uuid().'/logs')->assertNotFound();
});
