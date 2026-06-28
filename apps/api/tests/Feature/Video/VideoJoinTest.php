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
 * W1 — shareable join-by-link (docs/video-platform/06-WEB-CALL-CLIENT). The public endpoint
 * POST /api/video/join/{token} resolves a room through the SECURITY DEFINER reader (no tenant
 * context on the request) and maps the joiner to grants:
 *   AC-W1 — link resolves to a room; AC-W3 — host gets roomAdmin only with room.manage, a guest
 *   gets publish/subscribe only. Plus: archived → 404, RLS isolation (a foreign logged-in user is
 *   a guest, not a host), idempotent attendance rows, and the panel exposes + rotates the token.
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
    Http::fake(); // no real SFU calls

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->basicPlan = DB::table('plans')->where('code', 'BASIC')->value('id');

    $this->pro = $this->createAcademy(overrides: ['plan_id' => $this->proPlan]);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER');
    $this->proTeacher = $this->makeUser($this->pro, 'TEACHER');

    $this->basic = $this->createAcademy(overrides: ['plan_id' => $this->basicPlan]);
    $this->basicOwner = $this->makeUser($this->basic, 'ACADEMY_OWNER');
});

/**
 * Insert a room directly under its academy's RLS context (no HTTP, no Sanctum) and return its
 * id + join_token + livekit_name, leaving the connection in the no-context (public-page) state.
 *
 * @return array{id: string, token: string, livekit_name: string}
 */
function seedRoom(string $academyId): array
{
    $id = (string) Str::uuid();
    $token = Str::random(24);
    $livekit = 'r-'.substr($id, 0, 8).'__'.$academyId;

    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('video_rooms')->insert([
        'id' => $id,
        'academy_id' => $academyId,
        'name' => 'Halaqa — Live',
        'livekit_name' => $livekit,
        'join_token' => $token,
    ]);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    return ['id' => $id, 'token' => $token, 'livekit_name' => $livekit];
}

// ── AC-W3: an authenticated owner (room.manage) becomes host WITH roomAdmin ────────
it('an authenticated owner joins via the link as host with roomAdmin', function () {
    $room = seedRoom($this->pro);
    Sanctum::actingAs($this->proOwner);

    $res = $this->postJson("/api/video/join/{$room['token']}")->assertOk();

    expect($res->json('role'))->toBe('host');
    expect($res->json('identity'))->toBe((string) $this->proOwner->getKey());
    expect($res->json('url'))->toBe('wss://media.test');
    expect($res->json('roomName'))->toBe($room['livekit_name']);
    expect($res->json('roomTitle'))->toBe('Halaqa — Live');

    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['roomJoin'])->toBeTrue();
    expect($claims['video']['canPublish'])->toBeTrue();
    expect($claims['video']['roomAdmin'] ?? false)->toBeTrue();
    // The token lifetime honors the configured TTL — this is the credential a mid-call reconnect
    // re-auths with, so it must span a full lesson (see LivekitConfigTest for the shipped default).
    expect($claims['exp'] - $claims['nbf'])->toBe((int) config('services.livekit.token_ttl'));
});

// ── AC-W3: a teacher (room.join, NOT room.manage) is host WITHOUT roomAdmin ────────
it('an authenticated teacher joins as host but without roomAdmin', function () {
    $room = seedRoom($this->pro);
    Sanctum::actingAs($this->proTeacher);

    $res = $this->postJson("/api/video/join/{$room['token']}")->assertOk();

    expect($res->json('role'))->toBe('host');
    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['roomJoin'])->toBeTrue();
    expect($claims['video']['roomAdmin'] ?? false)->toBeFalse();
});

// ── AC-W3: an anonymous guest gets publish+subscribe ONLY (never roomAdmin) ────────
it('an anonymous guest joins with a name, publish+subscribe only', function () {
    $room = seedRoom($this->pro);

    $res = $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Sara'])->assertOk();

    expect($res->json('role'))->toBe('guest');
    expect($res->json('displayName'))->toBe('Sara');
    expect($res->json('identity'))->toStartWith('guest-');

    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['roomJoin'])->toBeTrue();
    expect($claims['video']['canPublish'])->toBeTrue();
    expect($claims['video']['canSubscribe'])->toBeTrue();
    expect($claims['video']['roomAdmin'] ?? false)->toBeFalse();
    expect($claims['name'])->toBe('Sara');
});

// ── a guest must supply a display name ────────────────────────────────────────────
it('rejects a guest join with no display name (422)', function () {
    $room = seedRoom($this->pro);

    $this->postJson("/api/video/join/{$room['token']}", [])->assertStatus(422);
});

// ── AC-W1: an archived room is not joinable ───────────────────────────────────────
it('rejects joining an archived room (404)', function () {
    $room = seedRoom($this->pro);

    $this->asAcademy($this->pro);
    DB::table('video_rooms')->where('id', $room['id'])->update(['status' => 'ARCHIVED', 'deleted_at' => now()]);
    $this->clearTenantContext();

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'X'])->assertNotFound();
});

// ── an unknown token resolves to nothing ──────────────────────────────────────────
it('returns 404 for an unknown join token', function () {
    $this->postJson('/api/video/join/totallybogustoken123456', ['display_name' => 'X'])->assertNotFound();
});

// ── V-TEN-1: a logged-in user from another academy is a GUEST, not a host ──────────
it('treats a logged-in user from another academy as a guest, not a host', function () {
    $room = seedRoom($this->pro);
    Sanctum::actingAs($this->basicOwner); // owner of a DIFFERENT academy

    $res = $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Outsider'])->assertOk();

    expect($res->json('role'))->toBe('guest');
    expect($res->json('identity'))->toStartWith('guest-');
    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['roomAdmin'] ?? false)->toBeFalse();
});

// ── attendance rows are written and idempotent on re-join ─────────────────────────
it('records an attendance row and does not duplicate on a host re-join', function () {
    $room = seedRoom($this->pro);
    Sanctum::actingAs($this->proOwner);

    $this->postJson("/api/video/join/{$room['token']}")->assertOk();
    $this->postJson("/api/video/join/{$room['token']}")->assertOk(); // reconnect, same identity

    $this->asAcademy($this->pro);
    $count = DB::table('room_participants')
        ->where('room_id', $room['id'])
        ->where('identity', (string) $this->proOwner->getKey())
        ->whereNull('left_at')
        ->count();
    expect($count)->toBe(1);

    $row = DB::table('room_participants')->where('room_id', $room['id'])->first();
    expect($row->role)->toBe('HOST');
    expect($row->user_id)->toBe((string) $this->proOwner->getKey());
});

it('records a guest attendance row with no user_id', function () {
    $room = seedRoom($this->pro);

    $this->postJson("/api/video/join/{$room['token']}", ['display_name' => 'Maryam'])->assertOk();

    $this->asAcademy($this->pro);
    $row = DB::table('room_participants')->where('room_id', $room['id'])->first();
    expect($row->role)->toBe('PARTICIPANT');
    expect($row->user_id)->toBeNull();
    expect($row->display_name)->toBe('Maryam');
});

// ── the management API exposes the token and can rotate it ─────────────────────────
it('exposes join_token on the room list/detail and rotates it', function () {
    Sanctum::actingAs($this->proOwner);
    $roomId = $this->postJson('/api/video/rooms', ['name' => 'Linkable'])->json('roomId');

    $listToken = $this->getJson('/api/video/rooms')->assertOk()->json('rooms.0.join_token');
    expect($listToken)->toBeString()->not->toBeEmpty();

    $showToken = $this->getJson("/api/video/rooms/{$roomId}")->assertOk()->json('room.join_token');
    expect($showToken)->toBe($listToken);

    $rotated = $this->postJson("/api/video/rooms/{$roomId}/rotate-link")->assertOk()->json('join_token');
    expect($rotated)->not->toBe($listToken);

    // The old link is dead; the new one resolves.
    $this->postJson("/api/video/join/{$listToken}", ['display_name' => 'X'])->assertNotFound();
    $this->postJson("/api/video/join/{$rotated}")->assertOk()->assertJsonPath('role', 'host');
});

it('forbids a teacher from rotating the link (room.manage only)', function () {
    $room = seedRoom($this->pro);
    Sanctum::actingAs($this->proTeacher);

    $this->postJson("/api/video/rooms/{$room['id']}/rotate-link")->assertForbidden();
});

// ── the public route is rate-limited (token-enumeration defense) ───────────────────
it('throttles the public join route', function () {
    $route = collect(app('router')->getRoutes())->first(
        fn ($r) => $r->uri() === 'api/video/join/{token}'
    );
    expect($route)->not->toBeNull();
    expect($route->gatherMiddleware())->toContain('throttle:60,1');
});
