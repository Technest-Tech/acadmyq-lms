<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Plan-level video controls (FeatureCatalog): the per-plan `maxRooms`, `maxRoomParticipants`,
 * `recordingRetentionDays` numeric limits + the fail-open `recordingAllowed` / `monitorAllowed`
 * flags. Lets a Super Admin sell a video-only plan that caps how many rooms an academy can create
 * and which room options (recording / supervisor mode / capacity / retention) it includes.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    config([
        'services.livekit.host' => 'wss://media.test',
        'services.livekit.api_url' => 'https://media.test',
        'services.livekit.api_key' => 'devkey',
        'services.livekit.api_secret' => str_repeat('s', 40),
        'services.livekit.recording_retention_days' => 90,
    ]);
    // Endpoint-specific stubs only — a broad catch-all here would shadow the per-test ListParticipants
    // stub (Http::fake APPENDS; the first-registered matching pattern wins).
    Http::fake([
        '*StartRoomCompositeEgress' => Http::response(['egress_id' => 'EG_1']),
        '*StopEgress' => Http::response([]),
    ]);
});

/** A video-only plan with the given limit/flag map. Inserted as Super Admin (catalog table). */
function seedVideoPlan(array $limits, array $caps = ['video.conferencing']): string
{
    $id = (string) Str::uuid();
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    DB::table('plans')->insert([
        'id' => $id,
        'code' => 'VID-'.substr($id, 0, 8),
        'name' => 'Video Only',
        'price_minor' => 0,
        'currency' => 'EGP',
        'features' => json_encode(['capabilities' => $caps, 'limits' => $limits]),
        'is_active' => true,
    ]);
    DB::statement("select set_config('app.current_role', '', true)");

    return $id;
}

/** Seed a room (with link tokens + config) under its academy's RLS context. */
function seedLimitedRoom(string $academyId, array $config): array
{
    $id = (string) Str::uuid();
    $row = [
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Limited',
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

    return ['id' => $id, 'join_token' => $row['join_token'], 'host_token' => $row['host_token'], 'monitor_token' => $row['monitor_token']];
}

// ── maxRooms ─────────────────────────────────────────────────────────────────────────
it('caps the number of rooms an academy can create', function () {
    $plan = seedVideoPlan(['maxRooms' => 1]);
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->postJson('/api/video/rooms', ['name' => 'Room 1'])->assertCreated();
    $this->postJson('/api/video/rooms', ['name' => 'Room 2'])
        ->assertStatus(402)->assertJsonPath('code', 'room_limit_reached')->assertJsonPath('limit', 1);
});

it('allows unlimited rooms when the plan sets no cap (fail open)', function () {
    $plan = seedVideoPlan([]); // no maxRooms
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->postJson('/api/video/rooms', ['name' => 'A'])->assertCreated();
    $this->postJson('/api/video/rooms', ['name' => 'B'])->assertCreated();
    $this->postJson('/api/video/rooms', ['name' => 'C'])->assertCreated();
});

// ── maxRoomParticipants ──────────────────────────────────────────────────────────────
it('enforces the plan participant cap on a guest join', function () {
    $plan = seedVideoPlan(['maxRoomParticipants' => 1]);
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $room = seedLimitedRoom($academy, ['max_participants' => null]);

    // The SFU already reports one participant → the 2nd guest exceeds the plan's cap of 1.
    Http::fake([
        '*ListParticipants' => Http::response([
            'participants' => [['identity' => 'g1', 'metadata' => json_encode(['role' => 'guest'])]],
        ]),
    ]);

    $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])
        ->assertStatus(409)->assertJsonPath('code', 'room_full');
});

// ── recordingAllowed flag ────────────────────────────────────────────────────────────
it('blocks recording when the plan excludes it', function () {
    $plan = seedVideoPlan(['recordingAllowed' => 0]);
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $room = seedLimitedRoom($academy, ['recording_enabled' => true]);

    $this->postJson("/api/video/manage/{$room['host_token']}/recording")
        ->assertStatus(403)->assertJsonPath('code', 'recording_not_in_plan');
});

it('allows recording when the plan does not disable it (fail open)', function () {
    $plan = seedVideoPlan([]); // recordingAllowed absent ⇒ allowed
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $room = seedLimitedRoom($academy, ['recording_enabled' => true]);

    $this->postJson("/api/video/manage/{$room['host_token']}/recording")->assertCreated();
});

// ── recordingRetentionDays ───────────────────────────────────────────────────────────
it('stamps the plan recording retention on a new recording', function () {
    $plan = seedVideoPlan(['recordingRetentionDays' => 7]);
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $room = seedLimitedRoom($academy, ['recording_enabled' => true]);

    $recId = $this->postJson("/api/video/manage/{$room['host_token']}/recording")->assertCreated()->json('recordingId');

    $this->asAcademy($academy);
    $expires = Carbon::parse(DB::table('room_recordings')->where('id', $recId)->value('expires_at'));
    // ~7 days out (not the global 90-day default).
    expect($expires->lessThan(now()->addDays(8)))->toBeTrue();
    expect($expires->greaterThan(now()->addDays(6)))->toBeTrue();
});

// ── monitorAllowed flag ──────────────────────────────────────────────────────────────
it('blocks supervisor mode when the plan excludes it', function () {
    $plan = seedVideoPlan(['monitorAllowed' => 0]);
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $room = seedLimitedRoom($academy, ['monitor_enabled' => true]);

    $this->postJson("/api/video/join/{$room['monitor_token']}")
        ->assertStatus(403)->assertJsonPath('code', 'monitor_disabled');
});

it('rejects enabling supervisor mode on a room when the plan excludes it', function () {
    $plan = seedVideoPlan(['monitorAllowed' => 0]);
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->postJson('/api/video/rooms', ['name' => 'Spy', 'settings' => ['monitor_enabled' => true]])
        ->assertStatus(403)->assertJsonPath('code', 'monitor_not_in_plan');
});

it('allows supervisor mode when the plan does not disable it (fail open)', function () {
    $plan = seedVideoPlan([]); // monitorAllowed absent ⇒ allowed
    $academy = $this->createAcademy(overrides: ['plan_id' => $plan]);
    $room = seedLimitedRoom($academy, ['monitor_enabled' => true]);

    $this->postJson("/api/video/join/{$room['monitor_token']}")
        ->assertOk()->assertJsonPath('role', 'monitor');
});
