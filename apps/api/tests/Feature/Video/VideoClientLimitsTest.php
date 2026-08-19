<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
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
 * Per-client video controls (docs/superadmin-modules/05-MODULES-NOT-PACKAGES §4): the `maxRooms`,
 * `maxRoomParticipants`, `recordingRetentionDays` caps + the fail-open `recordingAllowed` /
 * `monitorAllowed` flags a Super Admin sets on ONE client from its profile. Nothing is capped until
 * someone decides to cap it — there is no tier doing it on their behalf.
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

/** A video client capped exactly as this test needs (its own caps, no package). */
function videoLimitedClient(array $limits): string
{
    $academy = test()->createAcademy(overrides: ['client_type' => 'VIDEO'], modules: ['VIDEO']);

    if ($limits !== []) {
        test()->enterAcademyAsSuperAdmin($academy);
        app(ModuleBilling::class)->setLimitOverrides($academy, 'VIDEO', $limits);
        test()->clearTenantContext();
    }

    return $academy;
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
it('caps the number of rooms a capped client can create', function () {
    $academy = videoLimitedClient(['maxRooms' => 1]);
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->postJson('/api/video/rooms', ['name' => 'Room 1'])->assertCreated();
    $this->postJson('/api/video/rooms', ['name' => 'Room 2'])
        ->assertStatus(402)->assertJsonPath('code', 'room_limit_reached')->assertJsonPath('limit', 1);
});

it('allows unlimited rooms when nobody capped the client (fail open)', function () {
    $academy = videoLimitedClient([]); // no maxRooms
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->postJson('/api/video/rooms', ['name' => 'A'])->assertCreated();
    $this->postJson('/api/video/rooms', ['name' => 'B'])->assertCreated();
    $this->postJson('/api/video/rooms', ['name' => 'C'])->assertCreated();
});

// ── maxRoomParticipants ──────────────────────────────────────────────────────────────
it('enforces the client participant cap on a guest join', function () {
    $academy = videoLimitedClient(['maxRoomParticipants' => 1]);
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
it('blocks recording when we switched it off for the client', function () {
    $academy = videoLimitedClient(['recordingAllowed' => 0]);
    $room = seedLimitedRoom($academy, ['recording_enabled' => true]);

    $this->postJson("/api/video/manage/{$room['host_token']}/recording")
        ->assertStatus(403)->assertJsonPath('code', 'recording_not_in_plan');
});

it('allows recording when nobody switched it off (fail open)', function () {
    $academy = videoLimitedClient([]); // recordingAllowed absent ⇒ allowed
    $room = seedLimitedRoom($academy, ['recording_enabled' => true]);

    $this->postJson("/api/video/manage/{$room['host_token']}/recording")->assertCreated();
});

// ── recordingRetentionDays ───────────────────────────────────────────────────────────
it('stamps the client recording retention on a new recording', function () {
    $academy = videoLimitedClient(['recordingRetentionDays' => 7]);
    $room = seedLimitedRoom($academy, ['recording_enabled' => true]);

    $recId = $this->postJson("/api/video/manage/{$room['host_token']}/recording")->assertCreated()->json('recordingId');

    $this->asAcademy($academy);
    $expires = Carbon::parse(DB::table('room_recordings')->where('id', $recId)->value('expires_at'));
    // ~7 days out (not the global 90-day default).
    expect($expires->lessThan(now()->addDays(8)))->toBeTrue();
    expect($expires->greaterThan(now()->addDays(6)))->toBeTrue();
});

// ── monitorAllowed flag ──────────────────────────────────────────────────────────────
it('blocks supervisor mode when we switched it off for the client', function () {
    $academy = videoLimitedClient(['monitorAllowed' => 0]);
    $room = seedLimitedRoom($academy, ['monitor_enabled' => true]);

    $this->postJson("/api/video/join/{$room['monitor_token']}")
        ->assertStatus(403)->assertJsonPath('code', 'monitor_disabled');
});

it('rejects enabling supervisor mode on a room when we switched it off for the client it', function () {
    $academy = videoLimitedClient(['monitorAllowed' => 0]);
    $owner = $this->makeUser($academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $this->postJson('/api/video/rooms', ['name' => 'Spy', 'settings' => ['monitor_enabled' => true]])
        ->assertStatus(403)->assertJsonPath('code', 'monitor_not_in_plan');
});

it('allows supervisor mode when nobody switched it off (fail open)', function () {
    $academy = videoLimitedClient([]); // monitorAllowed absent ⇒ allowed
    $room = seedLimitedRoom($academy, ['monitor_enabled' => true]);

    $this->postJson("/api/video/join/{$room['monitor_token']}")
        ->assertOk()->assertJsonPath('role', 'monitor');
});
