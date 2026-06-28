<?php

declare(strict_types=1);

use App\Support\Entitlement;
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
 * Per-academy video governance — Tier 2 (Super Admin add-to-video / activate-deactivate / trial /
 * tier). Covers the entitlement override (force on/off, trial auto-expiry, video-tier limit merge),
 * the admin set-access write (audited, platform.manage-gated), the per-academy detail + room-logs
 * readers, and that a force-enabled academy with zero rooms still lists.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    $this->noVideoPlan = makeGovPlan('NOVID', []);
    $this->videoPlan = makeGovPlan('VIDPLAN', ['capabilities' => ['video.conferencing'], 'limits' => ['maxRooms' => 10]]);
    $this->videoTier = makeGovPlan('VIDTIER', ['capabilities' => ['video.conferencing'], 'limits' => ['maxRooms' => 3, 'maxRoomParticipants' => 25, 'recordingAllowed' => 0]]);
});

function makeGovPlan(string $code, array $features): string
{
    $id = (string) Str::uuid();
    DB::table('plans')->insert([
        'id' => $id, 'code' => $code, 'name' => "Plan {$code}",
        'price_minor' => 0, 'currency' => 'EGP',
        'features' => json_encode($features), 'is_active' => true,
    ]);

    return $id;
}

/** Set the academy's video-access columns directly (Super Admin context admits the write). */
function setVideoCols(string $academyId, array $cols): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('academies')->where('id', $academyId)->update($cols);
    test()->clearTenantContext();
}

/** Resolve the academy's entitlement under its own tenant context. */
function resolveGov(string $academyId): array
{
    test()->asAcademy($academyId, 'ACADEMY_OWNER');
    $r = Entitlement::resolve($academyId);
    test()->clearTenantContext();

    return $r;
}

/** Seed a video room under the academy context; returns its id. */
function seedGovRoom(string $academyId): string
{
    $id = (string) Str::uuid();
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('video_rooms')->insert([
        'id' => $id, 'academy_id' => $academyId, 'name' => 'Gov Room',
        'livekit_name' => 'r-'.substr($id, 0, 8).'__'.$academyId,
        'join_token' => 'gov-'.Str::lower(Str::random(6)), 'config' => json_encode([]),
    ]);
    test()->clearTenantContext();

    return $id;
}

// ── Entitlement override ──────────────────────────────────────────────────────────
it('force-enables video on a non-video plan and force-disables it on a video plan', function () {
    $on = $this->createAcademy(overrides: ['plan_id' => $this->noVideoPlan]);
    expect(resolveGov($on)['capabilities'])->not->toContain('video.conferencing');
    setVideoCols($on, ['video_access' => 'ENABLED']);
    expect(resolveGov($on)['capabilities'])->toContain('video.conferencing');

    $off = $this->createAcademy(overrides: ['plan_id' => $this->videoPlan]);
    expect(resolveGov($off)['capabilities'])->toContain('video.conferencing'); // plan grants it
    setVideoCols($off, ['video_access' => 'DISABLED']);
    expect(resolveGov($off)['capabilities'])->not->toContain('video.conferencing');
});

it('auto-expires a trial grant once the date passes', function () {
    $a = $this->createAcademy(overrides: ['plan_id' => $this->noVideoPlan]);
    setVideoCols($a, ['video_access' => 'ENABLED', 'video_trial_ends_at' => now()->addDays(5)]);
    expect(resolveGov($a)['capabilities'])->toContain('video.conferencing');

    setVideoCols($a, ['video_trial_ends_at' => now()->subDay()]);
    expect(resolveGov($a)['capabilities'])->not->toContain('video.conferencing');
});

it('merges only the video limit keys from the assigned video tier', function () {
    $a = $this->createAcademy(overrides: ['plan_id' => $this->videoPlan]);
    expect(resolveGov($a)['limits']['maxRooms'])->toBe(10); // from the plan

    setVideoCols($a, ['video_plan_id' => $this->videoTier]);
    $r = resolveGov($a);
    expect($r['limits']['maxRooms'])->toBe(3);              // tier wins
    expect($r['limits']['maxRoomParticipants'])->toBe(25);
    expect($r['limits']['recordingAllowed'])->toBe(0);
});

// ── set-access write ──────────────────────────────────────────────────────────────
it('activates video and audits the action (visible in the compliance feed)', function () {
    $a = $this->createAcademy(overrides: ['plan_id' => $this->noVideoPlan]);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/video/academies/{$a}/access", ['action' => 'enable'])
        ->assertOk()->assertJsonPath('ok', true)->assertJsonPath('academy.video_status', 'ENABLED');

    expect(resolveGov($a)['capabilities'])->toContain('video.conferencing');

    $actions = collect($this->getJson('/api/admin/video/compliance')->assertOk()->json('rows'))->pluck('action');
    expect($actions)->toContain('video.academy_access');
});

it('grants a trial with a tier, then reverts to plan', function () {
    $a = $this->createAcademy(overrides: ['plan_id' => $this->noVideoPlan]);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/video/academies/{$a}/access", [
        'action' => 'trial', 'trial_days' => 14, 'video_plan_id' => $this->videoTier,
    ])->assertOk()->assertJsonPath('academy.video_status', 'TRIAL');

    $r = resolveGov($a);
    expect($r['capabilities'])->toContain('video.conferencing');
    expect($r['limits']['maxRooms'])->toBe(3); // the tier's options apply

    $this->postJson("/api/admin/video/academies/{$a}/access", ['action' => 'follow_plan'])
        ->assertOk()->assertJsonPath('academy.video_status', 'NONE');
    expect(resolveGov($a)['capabilities'])->not->toContain('video.conferencing');
});

it('forbids a non-Super-Admin from the access write + the detail/logs reads', function () {
    $a = $this->createAcademy(overrides: ['plan_id' => $this->videoPlan]);
    $owner = $this->makeUser($a, 'ACADEMY_OWNER');

    Sanctum::actingAs($owner);
    $this->postJson("/api/admin/video/academies/{$a}/access", ['action' => 'enable'])->assertForbidden();
    $this->getJson("/api/admin/video/academies/{$a}")->assertForbidden();
    $this->getJson('/api/admin/video/plans')->assertForbidden();
});

// ── detail + room logs readers ─────────────────────────────────────────────────────
it('returns per-academy detail with status, stats and rooms', function () {
    $a = $this->createAcademy(overrides: ['plan_id' => $this->videoPlan]);
    seedGovRoom($a);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson("/api/admin/video/academies/{$a}")->assertOk();
    expect($res->json('academy.id'))->toBe($a);
    expect($res->json('academy.video_status'))->toBe('PLAN');
    expect($res->json('stats.total_rooms'))->toBe(1);
    expect($res->json('rooms'))->toHaveCount(1);

    $this->getJson('/api/admin/video/academies/'.Str::uuid())->assertNotFound();
});

it('returns a room log and rejects a room from another academy', function () {
    $a = $this->createAcademy(overrides: ['plan_id' => $this->videoPlan]);
    $room = seedGovRoom($a);
    $b = $this->createAcademy(overrides: ['plan_id' => $this->videoPlan]);
    $otherRoom = seedGovRoom($b);

    Sanctum::actingAs($this->admin);
    $this->getJson("/api/admin/video/academies/{$a}/rooms/{$room}/logs")->assertOk()
        ->assertJsonPath('room.id', $room);
    // The room belongs to B, not A → 404 (no cross-academy reach by id-swapping).
    $this->getJson("/api/admin/video/academies/{$a}/rooms/{$otherRoom}/logs")->assertNotFound();
});

// ── list includes a zero-room, force-enabled academy ───────────────────────────────
it('lists a force-enabled academy with no rooms in the usage feed', function () {
    $a = $this->createAcademy(overrides: ['plan_id' => $this->noVideoPlan, 'name' => 'Zero Room Video']);
    setVideoCols($a, ['video_access' => 'ENABLED']);

    Sanctum::actingAs($this->admin);
    $row = collect($this->getJson('/api/admin/video/usage')->assertOk()->json('academies'))
        ->firstWhere('academy_id', $a);
    expect($row)->not->toBeNull();
    expect($row['video_status'])->toBe('ENABLED');
    expect($row['active_rooms'])->toBe(0);
});

it('lists video-capable plans for the tier picker', function () {
    Sanctum::actingAs($this->admin);
    $codes = collect($this->getJson('/api/admin/video/plans')->assertOk()->json('plans'))->pluck('code');
    expect($codes)->toContain('VIDPLAN');
    expect($codes)->toContain('VIDTIER');
    expect($codes)->not->toContain('NOVID');
});
