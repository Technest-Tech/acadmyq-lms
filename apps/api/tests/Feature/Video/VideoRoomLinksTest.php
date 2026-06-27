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
 * S2 — role-separated links + short slugs (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §2/§3).
 * Covers link_role mapping (host/guest/monitor), the no-login host link (roomAdmin + optional host
 * password + HOST attendance), the authenticated-host override, the readable per-academy slug join,
 * slug validation (protection / subdomain / uniqueness), generalized rotate, and link exposure.
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
    $this->proTeacher = $this->makeUser($this->pro, 'TEACHER');
});

/**
 * Seed a room with explicit link tokens + config under its academy's RLS context.
 *
 * @param  array<string,mixed>  $config
 * @return array{id: string, join_token: string, host_token: string, monitor_token: string, slug: ?string, livekit_name: string}
 */
function seedLinkRoom(string $academyId, array $config = [], ?string $slug = null): array
{
    $id = (string) Str::uuid();
    $row = [
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Links',
        'livekit_name' => 'r-'.substr($id, 0, 8).'__'.$academyId,
        'join_token' => Str::random(24),
        'host_token' => Str::random(40),
        'monitor_token' => Str::random(40),
        'slug' => $slug,
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
        'slug' => $slug,
        'livekit_name' => $row['livekit_name'],
    ];
}

// ── host link (no-login) ─────────────────────────────────────────────────────────────
it('a host link grants host with roomAdmin and no login', function () {
    $room = seedLinkRoom($this->pro);

    $res = $this->postJson("/api/video/join/{$room['host_token']}", ['display_name' => 'Ustadh'])->assertOk();

    expect($res->json('role'))->toBe('host');
    expect($res->json('canManage'))->toBeTrue();
    expect($res->json('identity'))->toStartWith('host-');
    expect($res->json('displayName'))->toBe('Ustadh');

    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['roomAdmin'] ?? false)->toBeTrue();
    expect(json_decode($claims['metadata'], true)['role'])->toBe('host');
});

it('a host link requires the host password when set', function () {
    $room = seedLinkRoom($this->pro, ['host_password' => 'h0st-key']);

    $this->postJson("/api/video/join/{$room['host_token']}", ['display_name' => 'U'])
        ->assertStatus(422)->assertJsonPath('code', 'password_required');

    $this->postJson("/api/video/join/{$room['host_token']}", ['display_name' => 'U', 'password' => 'nope'])
        ->assertStatus(422)->assertJsonPath('code', 'password_incorrect');

    $this->postJson("/api/video/join/{$room['host_token']}", ['display_name' => 'U', 'password' => 'h0st-key'])
        ->assertOk()->assertJsonPath('role', 'host');
});

it('a host link writes a HOST attendance row with no user_id', function () {
    $room = seedLinkRoom($this->pro);

    $this->postJson("/api/video/join/{$room['host_token']}", ['display_name' => 'U'])->assertOk();

    $this->asAcademy($this->pro);
    $row = DB::table('room_participants')->where('room_id', $room['id'])->first();
    expect($row->role)->toBe('HOST');
    expect($row->user_id)->toBeNull();
});

// ── link role mapping ────────────────────────────────────────────────────────────────
it('the guest join_token resolves to a guest', function () {
    $room = seedLinkRoom($this->pro);

    $this->postJson("/api/video/join/{$room['join_token']}", ['display_name' => 'Sara'])
        ->assertOk()->assertJsonPath('role', 'guest');
});

it('a monitor link requires login (anonymous → 401)', function () {
    // Full monitor behaviour (hidden grant, room.monitor gate, audit) lives in VideoRoomMonitorTest.
    $room = seedLinkRoom($this->pro, ['monitor_enabled' => true]);

    $this->postJson("/api/video/join/{$room['monitor_token']}", ['display_name' => 'Boss'])
        ->assertStatus(401)->assertJsonPath('code', 'login_required');
});

it('an authenticated host on a host link keeps their own identity (auth wins)', function () {
    $room = seedLinkRoom($this->pro);
    Sanctum::actingAs($this->proOwner);

    $res = $this->postJson("/api/video/join/{$room['host_token']}")->assertOk();

    expect($res->json('role'))->toBe('host');
    expect($res->json('identity'))->toBe((string) $this->proOwner->getKey());
});

// ── slug validation (on create) ──────────────────────────────────────────────────────
it('creates a room with a slug behind a guest password', function () {
    Sanctum::actingAs($this->proOwner);

    $id = $this->postJson('/api/video/rooms', [
        'name' => 'Slugged',
        'slug' => 'Halaqa-1', // normalised to lowercase
        'settings' => ['guest_password' => 'open-pw'],
    ])->assertCreated()->json('roomId');

    $this->asAcademy($this->pro);
    expect(DB::table('video_rooms')->where('id', $id)->value('slug'))->toBe('halaqa-1');
});

it('rejects a slug without a guest password', function () {
    Sanctum::actingAs($this->proOwner);

    $this->postJson('/api/video/rooms', ['name' => 'X', 'slug' => 'open-room'])
        ->assertStatus(422)->assertJsonPath('code', 'slug_needs_password');
});

it('rejects a slug when the academy has no subdomain', function () {
    $bare = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]); // no subdomain
    $bareOwner = $this->makeUser($bare, 'ACADEMY_OWNER');
    Sanctum::actingAs($bareOwner);

    $this->postJson('/api/video/rooms', [
        'name' => 'X', 'slug' => 'room-a', 'settings' => ['guest_password' => 'pw12'],
    ])->assertStatus(422)->assertJsonPath('code', 'slug_needs_subdomain');
});

it('rejects a duplicate slug in the same academy', function () {
    seedLinkRoom($this->pro, ['guest_password' => 'pw12'], slug: 'halaqa-1');
    Sanctum::actingAs($this->proOwner);

    $this->postJson('/api/video/rooms', [
        'name' => 'Dup', 'slug' => 'halaqa-1', 'settings' => ['guest_password' => 'pw12'],
    ])->assertStatus(422)->assertJsonPath('code', 'slug_taken');
});

// ── slug join (the readable guest link) ──────────────────────────────────────────────
it('joins a room by its academy slug behind the guest password', function () {
    seedLinkRoom($this->pro, ['guest_password' => 'sesame'], slug: 'halaqa-1');

    // No password → prompted.
    $this->postJson('/api/video/join-slug/academyx/halaqa-1', ['display_name' => 'Sara'])
        ->assertStatus(422)->assertJsonPath('code', 'password_required');

    // Correct password → admitted as guest.
    $this->postJson('/api/video/join-slug/academyx/halaqa-1', ['display_name' => 'Sara', 'password' => 'sesame'])
        ->assertOk()->assertJsonPath('role', 'guest');
});

it('returns 404 for an unknown slug', function () {
    $this->postJson('/api/video/join-slug/academyx/ghost-room', ['display_name' => 'X'])->assertNotFound();
});

// ── rotate (generalized) ─────────────────────────────────────────────────────────────
it('rotates the host link and kills the old one', function () {
    $room = seedLinkRoom($this->pro);
    Sanctum::actingAs($this->proOwner);

    $fresh = $this->postJson("/api/video/rooms/{$room['id']}/rotate-link", ['which' => 'host'])
        ->assertOk()->json('token');
    expect($fresh)->not->toBe($room['host_token']);

    // Old host link no longer resolves; the new one grants host (anonymous, no login).
    $this->postJson("/api/video/join/{$room['host_token']}", ['display_name' => 'U'])->assertNotFound();
    $this->postJson("/api/video/join/{$fresh}", ['display_name' => 'U'])->assertOk()->assertJsonPath('role', 'host');
});

// ── exposure ─────────────────────────────────────────────────────────────────────────
it('exposes host_token and slug to a manager', function () {
    // monitor_token visibility (room.monitor only) is covered in VideoRoomMonitorTest.
    Sanctum::actingAs($this->proOwner);
    $id = $this->postJson('/api/video/rooms', ['name' => 'Linked'])->json('roomId');

    $room = $this->getJson("/api/video/rooms/{$id}")->assertOk()->json('room');
    expect($room['host_token'])->toBeString()->not->toBeEmpty();
    expect($room)->toHaveKey('slug');
});
