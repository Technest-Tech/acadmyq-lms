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
 * S4 — the waiting room (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §13). Covers: the knock
 * state at /join (no token minted), the guest short-poll lifecycle (knocking → admitted/denied), the
 * host queue authenticated by the manage credential (= host_token), all three bypasses (auth-host,
 * host link, monitor), the guest-password-before-knock ordering, and the broadened slug protection.
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
    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan, 'subdomain' => 'academyx']);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER');
});

/**
 * Seed a room with explicit link tokens + config under its academy's RLS context (unique helper name
 * — Pest file-scoped helpers are global).
 *
 * @param  array<string,mixed>  $config
 * @param  array<string,string>  $tokens  Override any of join_token/host_token/monitor_token (e.g. a
 *                                         real `{kebab-name}-{code}` short link with a `-` separator).
 * @return array{id: string, join_token: string, host_token: string, monitor_token: string, livekit_name: string}
 */
function seedWaitingRoom(string $academyId, array $config = [], array $tokens = []): array
{
    $id = (string) Str::uuid();
    $row = array_merge([
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Waiting',
        'livekit_name' => 'r-'.substr($id, 0, 8).'__'.$academyId,
        'join_token' => Str::random(24),
        'host_token' => Str::random(40),
        'monitor_token' => Str::random(40),
        'config' => json_encode($config),
    ], array_intersect_key($tokens, array_flip(['join_token', 'host_token', 'monitor_token'])));

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

// ── the knock state at /join ──────────────────────────────────────────────────────────
it('a guest joining a waiting room knocks instead of getting a token', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);

    $res = $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])->assertOk();

    expect($res->json('state'))->toBe('knocking');
    expect($res->json('knockToken'))->toBeString()->not->toBeEmpty();
    expect($res->json('token'))->toBeNull();      // no LiveKit token minted yet
    expect($res->json('roomTitle'))->toBe('Halaqa — Waiting');

    $this->asAcademy($this->pro);
    $knock = DB::table('room_knocks')->where('room_id', $room['id'])->first();
    expect($knock->status)->toBe('PENDING');
    expect($knock->display_name)->toBe('Sara');
    expect($knock->identity)->toStartWith('guest-');

    // No attendance row until admitted.
    expect(DB::table('room_participants')->where('room_id', $room['id'])->count())->toBe(0);
});

it('a knock requires a display name', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);

    $this->postJson("/api/video/join/{$room['join_token']}")->assertStatus(422);
});

// ── the guest poll lifecycle ──────────────────────────────────────────────────────────
it('the guest poll reports knocking while pending', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);
    $knockToken = $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])->json('knockToken');

    $this->postJson("/api/video/knock/{$knockToken}")
        ->assertOk()->assertJsonPath('state', 'knocking');
});

it('admitting a knock lets the guest poll through to a token + attendance row', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);
    $knockToken = $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])->json('knockToken');

    // Host admits via the manage credential (= host_token).
    $this->asAcademy($this->pro);
    $knockId = DB::table('room_knocks')->where('room_id', $room['id'])->value('id');

    $this->postJson("/api/video/manage/{$room['host_token']}/knocks/{$knockId}", ['decision' => 'admit'])
        ->assertOk()->assertJsonPath('status', 'ADMITTED');

    // The guest's next poll now returns the full join body + a token.
    $res = $this->postJson("/api/video/knock/{$knockToken}")->assertOk();
    expect($res->json('state'))->toBe('admitted');
    expect($res->json('role'))->toBe('guest');
    expect($res->json('token'))->toBeString()->not->toBeEmpty();
    expect($res->json('identity'))->toStartWith('guest-');

    $this->asAcademy($this->pro);
    $att = DB::table('room_participants')->where('room_id', $room['id'])->first();
    expect($att->role)->toBe('PARTICIPANT');
    expect($att->display_name)->toBe('Sara');
});

it('denying a knock blocks the guest with no token', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);
    $knockToken = $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])->json('knockToken');

    $this->asAcademy($this->pro);
    $knockId = DB::table('room_knocks')->where('room_id', $room['id'])->value('id');

    $this->postJson("/api/video/manage/{$room['host_token']}/knocks/{$knockId}", ['decision' => 'deny'])
        ->assertOk()->assertJsonPath('status', 'DENIED');

    $res = $this->postJson("/api/video/knock/{$knockToken}")->assertOk();
    expect($res->json('state'))->toBe('denied');
    expect($res->json('token'))->toBeNull();

    $this->asAcademy($this->pro);
    expect(DB::table('room_participants')->where('room_id', $room['id'])->count())->toBe(0);
});

it('a deny decision is idempotent — re-deciding returns the settled status', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);
    $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])->json('knockToken');

    $this->asAcademy($this->pro);
    $knockId = DB::table('room_knocks')->where('room_id', $room['id'])->value('id');

    $this->postJson("/api/video/manage/{$room['host_token']}/knocks/{$knockId}", ['decision' => 'admit'])
        ->assertOk()->assertJsonPath('status', 'ADMITTED');
    // A later deny does NOT override an already-admitted knock.
    $this->postJson("/api/video/manage/{$room['host_token']}/knocks/{$knockId}", ['decision' => 'deny'])
        ->assertOk()->assertJsonPath('status', 'ADMITTED');
});

it('returns 404 for an unknown knock token', function () {
    $this->postJson('/api/video/knock/'.Str::random(40))->assertNotFound();
});

// ── the host queue ───────────────────────────────────────────────────────────────────
it('the host queue lists pending knocks via the manage credential', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);
    $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara']);
    $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Yusuf']);

    $res = $this->getJson("/api/video/manage/{$room['host_token']}/knocks")->assertOk();
    $names = collect($res->json('knocks'))->pluck('displayName')->all();
    expect($names)->toContain('Sara')->toContain('Yusuf');
    expect($res->json('knocks'))->toHaveCount(2);
});

it('an admitted knock drops off the host queue', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);
    $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara']);

    $this->asAcademy($this->pro);
    $knockId = DB::table('room_knocks')->where('room_id', $room['id'])->value('id');
    $this->postJson("/api/video/manage/{$room['host_token']}/knocks/{$knockId}", ['decision' => 'admit'])->assertOk();

    $this->getJson("/api/video/manage/{$room['host_token']}/knocks")->assertOk()->assertJsonCount(0, 'knocks');
});

it('the host queue + recording resolve via a real hyphenated short host link', function () {
    // Regression: host_token is now a short link `{kebab-name}-{code}` with a `-` separator (e.g.
    // `halaqa-waiting-k3p9x`). The /video/manage/{manageToken}/* routes constrained the token to
    // [A-Za-z0-9]+, so the dash failed the pattern → a hard 404 on knocks AND recording from the host
    // link. The pattern must allow `-` like /video/join. (Egress is faked — we only assert the route
    // resolves to the controller, not 404.)
    Illuminate\Support\Facades\Http::fake([
        '*' => Illuminate\Support\Facades\Http::response(['egress_id' => 'EG_test'], 200),
    ]);
    $room = seedWaitingRoom($this->pro, ['recording_enabled' => true], ['host_token' => 'halaqa-waiting-k3p9x']);

    $this->getJson("/api/video/manage/{$room['host_token']}/knocks")
        ->assertOk()->assertJsonCount(0, 'knocks');

    $this->postJson("/api/video/manage/{$room['host_token']}/recording")
        ->assertCreated()->assertJsonStructure(['recordingId']);
});

it('the host queue rejects a non-host token', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);

    // A guest join_token is not a manage credential.
    $this->getJson("/api/video/manage/{$room['join_token']}/knocks")
        ->assertStatus(403)->assertJsonPath('code', 'manage_forbidden');
    // A monitor_token is not a manage credential either.
    $this->getJson("/api/video/manage/{$room['monitor_token']}/knocks")
        ->assertStatus(403)->assertJsonPath('code', 'manage_forbidden');
    // An unknown token is rejected the same way (no enumeration).
    $this->getJson('/api/video/manage/'.Str::random(40).'/knocks')
        ->assertStatus(403)->assertJsonPath('code', 'manage_forbidden');
});

// ── the bypasses (no wait for hosts / monitors) ──────────────────────────────────────
it('the no-login host link bypasses the waiting room', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);

    $res = $this->postJson("/api/video/join/{$room['host_token']}", ['display_name' => 'Ustadh'])->assertOk();

    expect($res->json('state'))->toBeNull();        // not knocking
    expect($res->json('role'))->toBe('host');
    expect($res->json('token'))->toBeString()->not->toBeEmpty();
    expect($res->json('manageToken'))->toBe($room['host_token']);
});

it('an authenticated host bypasses the waiting room and gets a manage credential', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true]);
    Sanctum::actingAs($this->proOwner);

    // Even on the GUEST link, the logged-in owner is host and receives the manage credential.
    $res = $this->postJson("/api/video/join/{$room['join_token']}")->assertOk();

    expect($res->json('role'))->toBe('host');
    expect($res->json('token'))->toBeString()->not->toBeEmpty();
    expect($res->json('manageToken'))->toBe($room['host_token']);
});

it('a guest gets no manage credential', function () {
    $room = seedWaitingRoom($this->pro, []); // no waiting room → straight guest token

    $res = $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])->assertOk();

    expect($res->json('role'))->toBe('guest');
    expect($res->json('manageToken'))->toBeNull();
});

// ── ordering: the guest password gates the knock ─────────────────────────────────────
it('the guest password is enforced before a knock is recorded', function () {
    $room = seedWaitingRoom($this->pro, ['waiting_room' => true, 'guest_password' => 'sesame']);

    // Wrong/absent password → no knock created.
    $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])
        ->assertStatus(422)->assertJsonPath('code', 'password_required');

    $this->asAcademy($this->pro);
    expect(DB::table('room_knocks')->where('room_id', $room['id'])->count())->toBe(0);
    $this->clearTenantContext();

    // Correct password → now they knock.
    $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara', 'password' => 'sesame'])
        ->assertOk()->assertJsonPath('state', 'knocking');
});

// ── slug protection broadened (password OR waiting room) ─────────────────────────────
it('allows a slug when the waiting room is on without a guest password', function () {
    Sanctum::actingAs($this->proOwner);

    $id = $this->postJson('/api/video/rooms', [
        'name' => 'Walk-in',
        'slug' => 'walk-in',
        'settings' => ['waiting_room' => true],
    ])->assertCreated()->json('roomId');

    $this->asAcademy($this->pro);
    expect(DB::table('video_rooms')->where('id', $id)->value('slug'))->toBe('walk-in');
});

it('still rejects a slug with neither a password nor a waiting room', function () {
    Sanctum::actingAs($this->proOwner);

    $this->postJson('/api/video/rooms', ['name' => 'X', 'slug' => 'open-room'])
        ->assertStatus(422)->assertJsonPath('code', 'slug_needs_password_or_waiting');
});
