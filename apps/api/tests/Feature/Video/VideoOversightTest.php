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
 * Super Admin video oversight — Tier 1 (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING). Covers the
 * two SECURITY DEFINER readers behind the page (cross-tenant usage aggregation + the compliance audit
 * feed), the platform.manage Gate (a non-admin is forbidden, RLS is the DB backstop), the monitor_join
 * visibility semantics (the Super Admin compliance feed is exactly where covert-supervision entries
 * MUST surface), and the service health card with its capacity hint.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    // A capped plan so max_rooms is reportable (FeatureCatalog `limits.maxRooms`).
    $this->cappedPlan = (string) Str::uuid();
    DB::table('plans')->insert([
        'id' => $this->cappedPlan,
        'code' => 'VIDEO5',
        'name' => 'Video 5',
        'price_minor' => 0,
        'currency' => 'EGP',
        'features' => json_encode(['limits' => ['maxRooms' => 5]]),
        'is_active' => true,
    ]);

    $this->A = $this->createAcademy(overrides: ['plan_id' => $this->cappedPlan, 'name' => 'Academy A']);
    $this->ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER');

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->B = $this->createAcademy(overrides: ['plan_id' => $proPlan, 'name' => 'Academy B']);
});

/** Seed a video room under its academy's RLS context; returns its id. */
function seedOversightRoom(string $academyId, array $overrides = []): string
{
    $id = (string) Str::uuid();
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('video_rooms')->insert(array_merge([
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa',
        'livekit_name' => 'r-'.substr($id, 0, 8).'__'.$academyId,
        'join_token' => 'halaqa-'.Str::lower(Str::random(6)),
        'status' => 'ACTIVE',
        'config' => json_encode([]),
    ], $overrides));
    test()->clearTenantContext();

    return $id;
}

/** Seed a recording under its academy's RLS context. */
function seedOversightRecording(string $academyId, string $roomId, array $overrides = []): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('room_recordings')->insert(array_merge([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'room_id' => $roomId,
        'status' => 'COMPLETED',
        'bytes' => 1_000_000_000,
        'duration_s' => 1800,
    ], $overrides));
    test()->clearTenantContext();
}

/** Seed an audit_log row (RLS insert policy is with-check(true) for the admin context). */
function seedOversightAudit(string $academyId, string $action, string $entityType = 'video_room'): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('audit_log')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'actor_user_id' => null,
        'actor_role' => 'ACADEMY_OWNER',
        'action' => $action,
        'entity_type' => $entityType,
        'entity_id' => (string) Str::uuid(),
        'created_at' => now(),
    ]);
    test()->clearTenantContext();
}

it('aggregates per-academy usage across tenants with plan caps + platform totals', function () {
    // Academy A: 2 active + 1 archived room, 2 completed recordings (2 GB / 3600 s), 1 in-flight.
    seedOversightRoom($this->A);
    $roomA2 = seedOversightRoom($this->A);
    seedOversightRoom($this->A, ['status' => 'ARCHIVED', 'deleted_at' => now()]);
    seedOversightRecording($this->A, $roomA2, ['bytes' => 1_000_000_000, 'duration_s' => 1800]);
    seedOversightRecording($this->A, $roomA2, ['bytes' => 1_000_000_000, 'duration_s' => 1800]);
    seedOversightRecording($this->A, $roomA2, ['status' => 'RECORDING', 'bytes' => null, 'duration_s' => null]);

    // Academy B: 1 active room, no recordings.
    seedOversightRoom($this->B);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/video/usage')->assertOk();

    $byId = collect($res->json('academies'))->keyBy('academy_id');
    expect($byId)->toHaveKey($this->A);
    expect($byId)->toHaveKey($this->B);

    $a = $byId[$this->A];
    expect($a['active_rooms'])->toBe(2);
    expect($a['max_rooms'])->toBe(5);                  // from the capped plan's limits.maxRooms
    expect($a['recordings_count'])->toBe(2);           // only COMPLETED
    expect((int) $a['storage_bytes'])->toBe(2_000_000_000);
    expect((int) $a['recording_seconds'])->toBe(3600);
    expect($a['active_recordings'])->toBe(1);          // the in-flight one

    $b = $byId[$this->B];
    expect($b['active_rooms'])->toBe(1);
    expect($b['recordings_count'])->toBe(0);
    expect($b['max_rooms'])->toBeNull();               // PRO has no maxRooms cap (fail open)

    expect($res->json('totals.active_rooms'))->toBe(3);
    expect($res->json('totals.recordings_count'))->toBe(2);
    expect($res->json('totals.active_recordings'))->toBe(1);
    expect((int) $res->json('totals.storage_bytes'))->toBe(2_000_000_000);
});

it('feeds the platform-wide compliance log with video.* actions from every academy', function () {
    seedOversightAudit($this->A, 'video_recording.start');
    seedOversightAudit($this->A, 'video.participant_removed');
    seedOversightAudit($this->B, 'video_room.rotate_link');
    // A non-video action must NOT appear in the compliance feed.
    seedOversightAudit($this->A, 'student.create', 'student');

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/video/compliance')->assertOk();

    $actions = collect($res->json('rows'))->pluck('action');
    expect($actions)->toContain('video_recording.start');
    expect($actions)->toContain('video.participant_removed');
    expect($actions)->toContain('video_room.rotate_link');
    expect($actions)->not->toContain('student.create');

    // Cross-tenant: rows from BOTH academies surface (with their names).
    $academies = collect($res->json('rows'))->pluck('academy_id')->unique();
    expect($academies)->toContain($this->A);
    expect($academies)->toContain($this->B);
    expect($res->json('total'))->toBe(3);
});

it('surfaces monitor_join in the Super Admin compliance feed (the anti-abuse control)', function () {
    // Unlike the per-room manager log, covert-supervision entries are exactly what the Super Admin
    // oversight feed exists to expose — they must appear here.
    seedOversightAudit($this->A, 'video_room.monitor_join');

    Sanctum::actingAs($this->admin);
    $actions = collect($this->getJson('/api/admin/video/compliance')->assertOk()->json('rows'))->pluck('action');
    expect($actions)->toContain('video_room.monitor_join');
});

it('forbids a non-Super-Admin from every oversight route', function () {
    Sanctum::actingAs($this->ownerA); // ACADEMY_OWNER lacks platform.manage
    $this->getJson('/api/admin/video/usage')->assertForbidden();
    $this->getJson('/api/admin/video/compliance')->assertForbidden();
    $this->getJson('/api/admin/video/health')->assertForbidden();
});

it('reports service health with a concurrent-recording capacity hint', function () {
    config([
        'services.livekit.api_url' => 'https://lk.test',
        'services.livekit.host' => 'wss://lk.test',
        'services.livekit.api_key' => 'key',
        'services.livekit.api_secret' => 'secret-value-at-least-32-chars-long!!',
        'services.livekit.s3_endpoint' => 'https://s3.test',
        'services.livekit.s3_bucket' => 'recordings',
    ]);
    Http::fake([
        '*Egress*' => Http::response(['items' => [['egress_id' => 'e1']]]),       // 1 active egress
        '*RoomService*' => Http::response(['rooms' => []]),
        '*' => Http::response('', 403),                                            // S3 root probe → reachable
    ]);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/video/health')->assertOk();

    expect($res->json('livekit.ok'))->toBeTrue();
    expect($res->json('egress.ok'))->toBeTrue();
    expect($res->json('egress.active'))->toBe(1);
    expect($res->json('storage.configured'))->toBeTrue();
    expect($res->json('storage.ok'))->toBeTrue();
    expect($res->json('capacity.active_recordings'))->toBe(1);
    expect($res->json('capacity.soft_limit'))->toBe(2);
    expect($res->json('capacity.level'))->toBe('busy');
});

it('degrades health gracefully when the video stack is unreachable', function () {
    config([
        'services.livekit.api_url' => 'https://lk.test',
        'services.livekit.api_key' => 'key',
        'services.livekit.api_secret' => 'secret-value-at-least-32-chars-long!!',
        'services.livekit.s3_endpoint' => '', // not configured
    ]);
    Http::fake(['*' => Http::response('boom', 500)]);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/video/health')->assertOk();

    expect($res->json('livekit.ok'))->toBeFalse();
    expect($res->json('egress.ok'))->toBeFalse();
    expect($res->json('storage.configured'))->toBeFalse();
    expect($res->json('capacity.level'))->toBe('unknown'); // no egress truth → unknown, not a crash
});
