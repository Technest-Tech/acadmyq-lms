<?php

declare(strict_types=1);

use App\Services\Livekit\Jwt;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Phase 1 — video rooms, scoped tokens and the two gating layers (docs/video-platform/05-ROADMAP).
 * AC-V1.1 (CRUD + tenant scope), AC-V1.2 (token grant matches capabilities), AC-V1.3 (entitlement
 * 402), AC-V1.4 (capability 403), AC-V1.5 (cross-tenant RLS). PRO bundles video.conferencing; BASIC
 * does not. The academy owns the room (V-CTL-1): owners create/manage, teachers only join.
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
    Http::fake(); // no real SFU calls (destroy does a best-effort DeleteRoom)

    $this->proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->basicPlan = DB::table('plans')->where('code', 'BASIC')->value('id');

    $this->pro = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);
    $this->proOwner = $this->makeUser($this->pro, 'ACADEMY_OWNER');
    $this->proTeacher = $this->makeUser($this->pro, 'TEACHER');

    $this->basic = $this->createAcademy();
    $this->basicOwner = $this->makeUser($this->basic, 'ACADEMY_OWNER');
});

// ── AC-V1.1: full CRUD, tenant-scoped ────────────────────────────────────────────
it('creates, lists, shows, updates and archives a room', function () {
    Sanctum::actingAs($this->proOwner);

    $roomId = $this->postJson('/api/video/rooms', ['name' => 'Halaqa 1'])->assertCreated()->json('roomId');

    $this->getJson('/api/video/rooms')->assertOk()->assertJsonPath('rooms.0.id', $roomId);
    $this->getJson("/api/video/rooms/{$roomId}")->assertOk()->assertJsonPath('room.name', 'Halaqa 1');

    $this->patchJson("/api/video/rooms/{$roomId}", ['name' => 'Halaqa 2'])->assertOk();
    $this->getJson("/api/video/rooms/{$roomId}")->assertJsonPath('room.name', 'Halaqa 2');

    $this->deleteJson("/api/video/rooms/{$roomId}")->assertOk();
    $this->getJson("/api/video/rooms/{$roomId}")->assertNotFound();
});

// ── AC-V1.2: the minted token's grant matches the caller's capabilities ───────────
it('mints a scoped token whose grant matches the caller capabilities', function () {
    Sanctum::actingAs($this->proOwner);
    $roomId = $this->postJson('/api/video/rooms', ['name' => 'R'])->json('roomId');

    // Owner holds room.manage → roomAdmin granted.
    $res = $this->postJson("/api/video/rooms/{$roomId}/token")->assertOk();
    $claims = Jwt::decode($res->json('token'), config('services.livekit.api_secret'));
    expect($claims['video']['roomJoin'])->toBeTrue();
    expect($claims['video']['room'])->toBe($res->json('room'));
    expect($claims['video']['canPublish'])->toBeTrue();
    expect($claims['video']['roomAdmin'] ?? false)->toBeTrue();
    expect($res->json('url'))->toBe('wss://media.test');

    // Teacher holds room.join but NOT room.manage → no roomAdmin.
    Sanctum::actingAs($this->proTeacher);
    $tk = $this->postJson("/api/video/rooms/{$roomId}/token")->assertOk()->json('token');
    $tclaims = Jwt::decode($tk, config('services.livekit.api_secret'));
    expect($tclaims['video']['roomJoin'])->toBeTrue();
    expect($tclaims['video']['roomAdmin'] ?? false)->toBeFalse();
});

// ── AC-V1.3: no entitlement → 402 upgrade-required (distinct from 403) ────────────
it('returns 402 upgrade-required when the plan lacks video', function () {
    Sanctum::actingAs($this->basicOwner);
    $res = $this->getJson('/api/video/rooms')->assertStatus(402);
    expect($res->json('error'))->toBe('upgrade_required');
    expect($res->json('feature'))->toBe('video.conferencing');
});

// ── AC-V1.4: entitled but lacking the capability → 403 forbidden ──────────────────
it('returns 403 when the role lacks the capability (a teacher cannot create a room)', function () {
    Sanctum::actingAs($this->proTeacher);
    $this->postJson('/api/video/rooms', ['name' => 'X'])->assertForbidden();
});

// ── AC-V1.5: a room is invisible across tenants (RLS) ─────────────────────────────
it('cannot see or token a room owned by another academy', function () {
    Sanctum::actingAs($this->proOwner);
    $roomId = $this->postJson('/api/video/rooms', ['name' => 'PRO room'])->json('roomId');

    $other = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);
    $otherOwner = $this->makeUser($other, 'ACADEMY_OWNER');

    Sanctum::actingAs($otherOwner);
    $this->getJson("/api/video/rooms/{$roomId}")->assertNotFound();
    $this->postJson("/api/video/rooms/{$roomId}/token")->assertNotFound();
});
