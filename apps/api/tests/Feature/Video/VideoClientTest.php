<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use App\Support\Entitlement;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The VIDEO client (docs/superadmin-modules/05-MODULES-NOT-PACKAGES §2) — a client whose whole
 * product is the video classroom, plus the per-client meet options (max rooms/participants,
 * recording retention, recording/monitor flags) a Super Admin varies from the client profile.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
});

/** Cap the client's video module exactly as its profile does. */
function videoCaps(string $academyId, array $limits): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    app(ModuleBilling::class)->setLimitOverrides($academyId, 'VIDEO', $limits);
    test()->clearTenantContext();
}

it('a video client resolves the classroom and the video-only workspace', function () {
    $academy = $this->createAcademy(overrides: ['client_type' => 'VIDEO']);

    // Entitlement always resolves inside the client's own context (RLS hides other tenants' subs).
    $this->enterAcademyAsSuperAdmin($academy);
    $caps = Entitlement::resolve($academy)['capabilities'];
    expect($caps)->toContain('video.conferencing')->toContain('video.only')
        ->not->toContain('invoicing')->not->toContain('payroll');
});

it('a leftover force-off never empties a video client (stop them by pausing the module)', function () {
    $academy = $this->createAcademy(overrides: ['client_type' => 'VIDEO']);
    $this->enterAcademyAsSuperAdmin($academy);

    // The video ops screen's "disable" would strip the classroom from a school; for a client whose
    // entire product IS the classroom it must not, or the panel would show them nothing at all.
    DB::table('module_subscriptions')->where('academy_id', $academy)->where('module', 'VIDEO')
        ->update(['overrides' => json_encode(['access' => 'DISABLED'])]);
    expect(Entitlement::resolve($academy)['capabilities'])->toContain('video.conferencing');

    // Pausing the module is how they actually stop.
    app(ModuleBilling::class)->pause($academy, 'VIDEO');
    expect(Entitlement::resolve($academy)['capabilities'])->not->toContain('video.conferencing');
});

it('is uncapped until we cap it, and a cap only touches the keys it names', function () {
    $academy = $this->createAcademy(overrides: ['client_type' => 'VIDEO']);
    $this->enterAcademyAsSuperAdmin($academy);

    // No package, no caps: unlimited rooms/participants and every flag open (fail open).
    expect(Entitlement::limitFor($academy, 'maxRoomParticipants'))->toBeNull();
    expect(Entitlement::limitFor($academy, 'maxRooms'))->toBeNull();
    expect(Entitlement::flagFor($academy, 'monitorAllowed'))->toBeTrue();

    videoCaps($academy, ['maxRoomParticipants' => 8, 'monitorAllowed' => 0]);
    $this->enterAcademyAsSuperAdmin($academy);

    expect(Entitlement::limitFor($academy, 'maxRoomParticipants'))->toBe(8);
    expect(Entitlement::flagFor($academy, 'monitorAllowed'))->toBeFalse();
    expect(Entitlement::limitFor($academy, 'maxRooms'))->toBeNull(); // untouched → still unlimited
});

it('the Super Admin setAccess endpoint stores per-client meet options', function () {
    $admin = $this->makeUser(null, 'SUPER_ADMIN');
    Sanctum::actingAs($admin);
    $academy = $this->createAcademy();

    $this->postJson("/api/admin/video/academies/{$academy}/access", [
        'action' => 'enable',
        'overrides' => ['maxRoomParticipants' => 12, 'recordingAllowed' => false],
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($academy);
    expect(Entitlement::limitFor($academy, 'maxRoomParticipants'))->toBe(12);
    expect(Entitlement::flagFor($academy, 'recordingAllowed'))->toBeFalse();

    // An all-empty override clears it (back to uncapped).
    $this->postJson("/api/admin/video/academies/{$academy}/access", [
        'action' => 'set_tier',
        'overrides' => [],
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($academy);
    expect(Entitlement::limitFor($academy, 'maxRoomParticipants'))->toBeNull();
});
