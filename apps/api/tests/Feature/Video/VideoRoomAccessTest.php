<?php

declare(strict_types=1);

use App\Services\Livekit\Jwt;
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
 * S1 — Room access settings (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §4). Per-room settings
 * live in the existing config JSONB and are enforced server-side at the public join endpoint and in
 * the token grants. Covers: optional guest password (OFF by default, AC-8.2), the guest-screenshare
 * grant (AC-8.4), the recording gate (AC-8.4), require_host_present + max_participants (AC-8.4), the
 * monitor disclosure flag (AC-8.6), and settings persistence on create/update.
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
    // NB: do NOT register a no-arg Http::fake() here — its catch-all is matched before any per-test
    // stub (fake() appends), which would shadow ListParticipants. The only tests that hit the SFU
    // (require_host_present / max_participants) fake it explicitly; every other path makes no HTTP call.

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');

    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER');
});

/**
 * Insert a room with a given settings config directly under its academy's RLS context, leaving the
 * connection context-free (the public-page state). Named distinctly from VideoJoinTest::seedRoom to
 * avoid a global redeclare when Pest loads both files.
 *
 * @param  array<string,mixed>  $config
 * @return array{id: string, token: string, livekit_name: string}
 */
function seedRoomAccess(string $academyId, array $config = []): array
{
    $id = (string) Str::uuid();
    $token = Str::random(24);
    $livekit = 'r-'.substr($id, 0, 8).'__'.$academyId;

    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert([
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Access',
        'livekit_name' => $livekit,
        'join_token' => $token,
        'config' => json_encode($config),
    ]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return ['id' => $id, 'token' => $token, 'livekit_name' => $livekit];
}

// ── settings persistence ───────────────────────────────────────────────────────────
it('persists access settings on create with sensible defaults', function () {
    Sanctum::actingAs($this->proOwner);

    $id = $this->postJson('/api/video/rooms', [
        'name' => 'Configured',
        'settings' => [
            'guest_password' => 's3cret',
            'mute_guests_on_join' => true,
            'max_participants' => 10,
            'monitor_enabled' => true,
        ],
    ])->assertCreated()->json('roomId');

    $this->asAcademy($this->pro);
    $config = json_decode((string) DB::table('video_rooms')->where('id', $id)->value('config'), true);

    expect($config['guest_password'])->toBe('s3cret');
    expect($config['mute_guests_on_join'])->toBeTrue();
    expect($config['max_participants'])->toBe(10);
    expect($config['monitor_enabled'])->toBeTrue();
    // Untouched keys fall back to defaults that preserve today's behaviour.
    expect($config['recording_enabled'])->toBeTrue();
    expect($config['allow_guest_screenshare'])->toBeTrue();
    expect($config['host_password'])->toBeNull();
    expect($config['waiting_room'])->toBeFalse();
});

it('merges settings on update without clobbering the others', function () {
    $room = seedRoomAccess($this->pro, ['guest_password' => 'keepme', 'recording_enabled' => true]);
    Sanctum::actingAs($this->proOwner);

    $this->patchJson("/api/video/rooms/{$room['id']}", [
        'settings' => ['recording_enabled' => false],
    ])->assertOk();

    $this->asAcademy($this->pro);
    $config = json_decode((string) DB::table('video_rooms')->where('id', $room['id'])->value('config'), true);

    expect($config['recording_enabled'])->toBeFalse();
    expect($config['guest_password'])->toBe('keepme'); // preserved
});

it('normalises an empty-string password to no password', function () {
    $room = seedRoomAccess($this->pro, ['guest_password' => 'oldpass']);
    Sanctum::actingAs($this->proOwner);

    $this->patchJson("/api/video/rooms/{$room['id']}", [
        'settings' => ['guest_password' => ''],
    ])->assertOk();

    $this->asAcademy($this->pro);
    $config = json_decode((string) DB::table('video_rooms')->where('id', $room['id'])->value('config'), true);
    expect($config['guest_password'])->toBeNull();
});

it('rejects a too-short password (422)', function () {
    $room = seedRoomAccess($this->pro);
    Sanctum::actingAs($this->proOwner);

    $this->patchJson("/api/video/rooms/{$room['id']}", [
        'settings' => ['guest_password' => 'ab'],
    ])->assertStatus(422);
});

// ── guest password enforcement (OPTIONAL — off by default) ───────────────────────────
it('lets a guest join when no password is set', function () {
    $room = seedRoomAccess($this->pro); // empty config → no password

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])
        ->assertOk()
        ->assertJsonPath('role', 'guest');
});

it('requires a password when guest_password is set', function () {
    $room = seedRoomAccess($this->pro, ['guest_password' => 'open-sesame']);

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])
        ->assertStatus(422)
        ->assertJsonPath('code', 'password_required');
});

it('rejects an incorrect guest password', function () {
    $room = seedRoomAccess($this->pro, ['guest_password' => 'open-sesame']);

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara', 'password' => 'wrong'])
        ->assertStatus(422)
        ->assertJsonPath('code', 'password_incorrect');
});

it('admits a guest with the correct guest password', function () {
    $room = seedRoomAccess($this->pro, ['guest_password' => 'open-sesame']);

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara', 'password' => 'open-sesame'])
        ->assertOk()
        ->assertJsonPath('role', 'guest');
});

it('lets an authenticated host bypass the guest password', function () {
    $room = seedRoomAccess($this->pro, ['guest_password' => 'open-sesame']);
    Sanctum::actingAs($this->proOwner);

    // No password supplied — the identity-verified host is not subject to the guest gate.
    $this->postJson("/api/video/join/{$room['token']}")
        ->assertOk()
        ->assertJsonPath('role', 'host');
});

// ── guest screenshare grant ──────────────────────────────────────────────────────────
it('restricts the guest token to camera+mic when guest screenshare is disabled', function () {
    $room = seedRoomAccess($this->pro, ['allow_guest_screenshare' => false]);

    $res = $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])->assertOk();

    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['canPublishSources'])->toBe(['camera', 'microphone']);
});

it('lets a guest publish screen share by default (no source restriction)', function () {
    $room = seedRoomAccess($this->pro); // default allow_guest_screenshare = true

    $res = $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])->assertOk();

    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['canPublishSources'] ?? null)->toBeNull();
});

it('marks the guest token role in metadata', function () {
    $room = seedRoomAccess($this->pro);

    $res = $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])->assertOk();

    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect(json_decode($claims['metadata'], true)['role'])->toBe('guest');
});

// ── recording gate ───────────────────────────────────────────────────────────────────
it('blocks starting a recording when recording is disabled for the room', function () {
    $room = seedRoomAccess($this->pro, ['recording_enabled' => false]);
    Sanctum::actingAs($this->proOwner);

    $this->postJson("/api/video/rooms/{$room['id']}/recording")->assertForbidden();
});

it('reports recordingEnabled=false in the join response', function () {
    $room = seedRoomAccess($this->pro, ['recording_enabled' => false]);
    Sanctum::actingAs($this->proOwner);

    $this->postJson("/api/video/join/{$room['token']}")
        ->assertOk()
        ->assertJsonPath('recordingEnabled', false);
});

// ── require_host_present + max_participants (SFU live state) ──────────────────────────
it('blocks a guest when require_host_present and no host is connected', function () {
    $room = seedRoomAccess($this->pro, ['require_host_present' => true]);
    Http::fake(['*ListParticipants' => Http::response(['participants' => []])]); // no one connected yet

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'host_absent');
});

it('admits a guest when a host is present', function () {
    $room = seedRoomAccess($this->pro, ['require_host_present' => true]);
    Http::fake([
        '*ListParticipants' => Http::response(['participants' => [
            ['identity' => 'teacher-1', 'metadata' => json_encode(['role' => 'host'])],
        ]]),
        '*' => Http::response([], 200),
    ]);

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])
        ->assertOk()
        ->assertJsonPath('role', 'guest');
});

it('rejects a guest when the room is at max_participants', function () {
    $room = seedRoomAccess($this->pro, ['max_participants' => 2]);
    Http::fake([
        '*ListParticipants' => Http::response(['participants' => [
            ['identity' => 'a'],
            ['identity' => 'b'],
        ]]),
        '*' => Http::response([], 200),
    ]);

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'room_full');
});

it('does not count a hidden monitor toward capacity', function () {
    $room = seedRoomAccess($this->pro, ['max_participants' => 2]);
    Http::fake([
        '*ListParticipants' => Http::response(['participants' => [
            ['identity' => 'a'],
            ['identity' => 'mon', 'metadata' => json_encode(['role' => 'monitor'])],
        ]]),
        '*' => Http::response([], 200),
    ]);

    // One real participant + one ghost monitor = 1 joinable < 2 → admitted.
    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])
        ->assertOk()
        ->assertJsonPath('role', 'guest');
});

// ── monitor disclosure flag (consent surface for §5) ─────────────────────────────────
it('returns monitorDisclosure=true when the room is monitor-enabled', function () {
    $room = seedRoomAccess($this->pro, ['monitor_enabled' => true]);

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])
        ->assertOk()
        ->assertJsonPath('monitorDisclosure', true);
});

it('returns monitorDisclosure=false for an ordinary room', function () {
    $room = seedRoomAccess($this->pro);

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])
        ->assertOk()
        ->assertJsonPath('monitorDisclosure', false);
});
