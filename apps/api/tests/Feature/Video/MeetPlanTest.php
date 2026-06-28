<?php

declare(strict_types=1);

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
 * The "Meet Plan" — a video-conferencing-ONLY plan (capabilities = video.conferencing + video.only) —
 * plus the free-form PER-ACADEMY meet-option override (academies.video_overrides) that lets a Super
 * Admin vary max rooms/participants, recording retention, and the recording/monitor flags per academy.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
});

it('seeds a video-only Meet Plan granting video.conferencing + video.only', function () {
    $plan = DB::table('plans')->where('code', 'MEET')->first();
    expect($plan)->not->toBeNull();

    $features = json_decode($plan->features, true);
    expect($features['capabilities'])->toContain('video.conferencing')->toContain('video.only')
        ->not->toContain('invoicing')->not->toContain('payroll'); // video-only
    expect($features['limits']['maxRoomParticipants'])->toBe(50);
    expect($features['limits']['recordingAllowed'])->toBe(1);
});

it('an academy on the Meet Plan resolves video.conferencing + video.only', function () {
    $meet = DB::table('plans')->where('code', 'MEET')->value('id');
    $academy = $this->createAcademy(overrides: ['plan_id' => $meet]);

    $caps = Entitlement::resolve($academy)['capabilities'];
    expect($caps)->toContain('video.conferencing')->toContain('video.only');
});

it('a DISABLED / expired-trial video override does NOT strip video from a Meet (video-only) plan', function () {
    $meet = DB::table('plans')->where('code', 'MEET')->value('id');
    $academy = $this->createAcademy(overrides: ['plan_id' => $meet]);

    $this->enterAcademyAsSuperAdmin($academy);

    // A leftover Super-Admin "video disabled" override would otherwise force video.conferencing OFF —
    // but a video-only academy must never be left with zero features, so the plan wins.
    DB::table('academies')->where('id', $academy)->update(['video_access' => 'DISABLED']);
    expect(Entitlement::resolve($academy)['capabilities'])->toContain('video.conferencing');

    // Same for an ENABLED grant whose trial date has already passed.
    DB::table('academies')->where('id', $academy)->update([
        'video_access' => 'ENABLED',
        'video_trial_ends_at' => now()->subDay(),
    ]);
    expect(Entitlement::resolve($academy)['capabilities'])->toContain('video.conferencing');
});

it('a per-academy override beats the plan for video limit keys, leaving others intact', function () {
    $meet = DB::table('plans')->where('code', 'MEET')->value('id');
    $academy = $this->createAcademy(overrides: ['plan_id' => $meet]);

    // Plan defaults
    expect(Entitlement::limitFor($academy, 'maxRoomParticipants'))->toBe(50);
    expect(Entitlement::limitFor($academy, 'maxRooms'))->toBe(25);
    expect(Entitlement::flagFor($academy, 'monitorAllowed'))->toBeTrue();

    // Per-academy override → cut participants to 8 and turn monitor mode off. Stay in the academy's
    // super-admin context so the RLS-protected academies/plans rows remain readable for resolve().
    $this->enterAcademyAsSuperAdmin($academy);
    DB::table('academies')->where('id', $academy)->update([
        'video_overrides' => json_encode(['limits' => ['maxRoomParticipants' => 8, 'monitorAllowed' => 0]]),
    ]);

    expect(Entitlement::limitFor($academy, 'maxRoomParticipants'))->toBe(8); // override wins
    expect(Entitlement::flagFor($academy, 'monitorAllowed'))->toBeFalse();   // override wins
    expect(Entitlement::limitFor($academy, 'maxRooms'))->toBe(25);           // untouched → from plan
});

it('the Super Admin setAccess endpoint stores per-academy meet options', function () {
    $admin = $this->makeUser(null, 'SUPER_ADMIN');
    Sanctum::actingAs($admin);
    $academy = $this->createAcademy();

    $this->postJson("/api/admin/video/academies/{$academy}/access", [
        'action' => 'enable',
        'overrides' => ['maxRoomParticipants' => 12, 'recordingAllowed' => false],
    ])->assertOk();

    expect(Entitlement::limitFor($academy, 'maxRoomParticipants'))->toBe(12);
    expect(Entitlement::flagFor($academy, 'recordingAllowed'))->toBeFalse();

    // An all-empty override clears it (revert to plan/tier).
    $this->postJson("/api/admin/video/academies/{$academy}/access", [
        'action' => 'set_tier',
        'overrides' => [],
    ])->assertOk();

    expect(DB::table('academies')->where('id', $academy)->value('video_overrides'))->toBeNull();
});
