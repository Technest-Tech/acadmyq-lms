<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
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

});

/** Force the VIDEO module's legacy access switch / trial clock, as the ops screen writes them. */
function setVideoOverride(string $academyId, array $overrides): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $engine = app(ModuleBilling::class);
    $sub = $engine->current($academyId, 'VIDEO') ?? $engine->ensure($academyId, 'VIDEO');
    DB::table('module_subscriptions')->where('id', $sub->id)->update([
        'overrides' => $overrides === [] ? null : json_encode($overrides),
        'updated_at' => now(),
    ]);
    test()->clearTenantContext();
}

/** Enable / cap the client's video module the way its profile does. */
function govEnableVideo(string $academyId, array $limits = []): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    $engine = app(ModuleBilling::class);
    $engine->enable($academyId, 'VIDEO', trial: false);
    if ($limits !== []) {
        $engine->setLimitOverrides($academyId, 'VIDEO', $limits);
    }
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
it('grants the classroom to a client we sold the module to, and the ops force-off still cuts it', function () {
    $on = $this->createAcademy();
    expect(resolveGov($on)['capabilities'])->not->toContain('video.conferencing');
    govEnableVideo($on);
    expect(resolveGov($on)['capabilities'])->toContain('video.conferencing');

    setVideoOverride($on, ['access' => 'DISABLED']);
    expect(resolveGov($on)['capabilities'])->not->toContain('video.conferencing');
});

it('auto-expires a module trial once the date passes', function () {
    $a = $this->createAcademy();
    $this->enterAcademyAsSuperAdmin($a);
    app(ModuleBilling::class)->enable($a, 'VIDEO', trial: true, trialDays: 5);
    $this->clearTenantContext();
    expect(resolveGov($a)['capabilities'])->toContain('video.conferencing');

    $this->enterAcademyAsSuperAdmin($a);
    DB::table('module_subscriptions')->where('academy_id', $a)->where('module', 'VIDEO')
        ->update(['trial_end' => now()->subDay()]);
    $this->clearTenantContext();
    expect(resolveGov($a)['capabilities'])->not->toContain('video.conferencing');
});

it('applies only this client own video caps, leaving every other key unlimited', function () {
    $a = $this->createAcademy();
    govEnableVideo($a);
    expect(resolveGov($a)['limits'])->toBe([]); // uncapped by default

    govEnableVideo($a, ['maxRooms' => 3, 'maxRoomParticipants' => 25, 'recordingAllowed' => 0]);
    $r = resolveGov($a);
    expect($r['limits']['maxRooms'])->toBe(3);
    expect($r['limits']['maxRoomParticipants'])->toBe(25);
    expect($r['limits']['recordingAllowed'])->toBe(0);
});

// ── set-access write ──────────────────────────────────────────────────────────────
it('activates video and audits the action (visible in the compliance feed)', function () {
    $a = $this->createAcademy();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/video/academies/{$a}/access", ['action' => 'enable'])
        ->assertOk()->assertJsonPath('ok', true)->assertJsonPath('academy.video_status', 'ENABLED');

    expect(resolveGov($a)['capabilities'])->toContain('video.conferencing');

    $actions = collect($this->getJson('/api/admin/video/compliance')->assertOk()->json('rows'))->pluck('action');
    expect($actions)->toContain('video.academy_access');
});

it('grants a trial with per-client meet options, then takes the module away', function () {
    $a = $this->createAcademy();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/video/academies/{$a}/access", [
        'action' => 'trial', 'trial_days' => 14, 'overrides' => ['maxRooms' => 3],
    ])->assertOk()->assertJsonPath('academy.video_status', 'TRIAL');

    $r = resolveGov($a);
    expect($r['capabilities'])->toContain('video.conferencing');
    expect($r['limits']['maxRooms'])->toBe(3); // this client's own cap

    $this->enterAcademyAsSuperAdmin($a);
    app(ModuleBilling::class)->end($a, 'VIDEO');
    $this->clearTenantContext();
    expect(resolveGov($a)['capabilities'])->not->toContain('video.conferencing');
});

it('forbids a non-Super-Admin from the access write + the detail/logs reads', function () {
    $a = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);
    $owner = $this->makeUser($a, 'ACADEMY_OWNER');

    Sanctum::actingAs($owner);
    $this->postJson("/api/admin/video/academies/{$a}/access", ['action' => 'enable'])->assertForbidden();
    $this->getJson("/api/admin/video/academies/{$a}")->assertForbidden();
});

// ── detail + room logs readers ─────────────────────────────────────────────────────
it('returns per-academy detail with status, stats and rooms', function () {
    $a = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);
    seedGovRoom($a);

    Sanctum::actingAs($this->admin);
    $res = $this->getJson("/api/admin/video/academies/{$a}")->assertOk();
    expect($res->json('academy.id'))->toBe($a);
    expect($res->json('academy.video_status'))->toBe('ENABLED');
    expect($res->json('stats.total_rooms'))->toBe(1);
    expect($res->json('rooms'))->toHaveCount(1);

    $this->getJson('/api/admin/video/academies/'.Str::uuid())->assertNotFound();
});

it('returns a room log and rejects a room from another academy', function () {
    $a = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);
    $room = seedGovRoom($a);
    $b = $this->createAcademy(modules: ['MANAGEMENT', 'VIDEO']);
    $otherRoom = seedGovRoom($b);

    Sanctum::actingAs($this->admin);
    $this->getJson("/api/admin/video/academies/{$a}/rooms/{$room}/logs")->assertOk()
        ->assertJsonPath('room.id', $room);
    // The room belongs to B, not A → 404 (no cross-academy reach by id-swapping).
    $this->getJson("/api/admin/video/academies/{$a}/rooms/{$otherRoom}/logs")->assertNotFound();
});

// ── list includes a zero-room, force-enabled academy ───────────────────────────────
it('lists a client with the module and no rooms in the usage feed', function () {
    $a = $this->createAcademy(overrides: ['name' => 'Zero Room Video']);
    govEnableVideo($a);

    Sanctum::actingAs($this->admin);
    $row = collect($this->getJson('/api/admin/video/usage')->assertOk()->json('academies'))
        ->firstWhere('academy_id', $a);
    expect($row)->not->toBeNull();
    expect($row['video_status'])->toBe('ENABLED');
    expect($row['active_rooms'])->toBe(0);
});
