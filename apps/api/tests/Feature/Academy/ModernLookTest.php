<?php

declare(strict_types=1);

use App\Support\AcademyProfile;
use App\Support\Entitlement;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/*
 * `modern_look`: the new workspace design for a Quran academy, switched on per client from Super
 * Admin. It is the look and nothing else: off for every client until someone picks it, and switching
 * it on moves no other feature and does not make the academy a centre.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->academy = $this->createAcademy();
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
});

it('is off for a client nobody picked', function () {
    Sanctum::actingAs($this->owner);

    expect($this->getJson('/api/auth/me')->assertOk()->json('capabilities'))->not->toContain('modern_look');
});

it('is offered on the client profile as an opt-in switch', function () {
    Sanctum::actingAs($this->admin);
    $catalog = $this->getJson("/api/admin/clients/{$this->academy}")->assertOk()->json('catalog.modules.MANAGEMENT');

    expect($catalog['capabilities'])->toHaveKey('modern_look')
        ->and($catalog['opt_in'])->toContain('modern_look');
});

it('reaches the session once switched on, and changes nothing else', function () {
    Sanctum::actingAs($this->owner);
    $before = $this->getJson('/api/auth/me')->assertOk()->json('capabilities');
    expect($before)->toContain('supervision', 'packages');

    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$this->academy}/modules/management/features", ['enabled' => ['modern_look']])
        ->assertOk();

    Sanctum::actingAs($this->owner);
    $me = $this->getJson('/api/auth/me')->assertOk();
    expect($me->json('capabilities'))->toContain('modern_look')
        ->and(array_values(array_diff($me->json('capabilities'), ['modern_look'])))->toEqualCanonicalizing($before)
        // Still a Quran academy: the look is not the centre profile, so no preset moved.
        ->and($me->json('academy.profile'))->toBe(AcademyProfile::QURAN);

    // And it comes off again the same way.
    Sanctum::actingAs($this->admin);
    $this->putJson("/api/admin/clients/{$this->academy}/modules/management/features", ['enabled' => []])->assertOk();
    $this->enterAcademyAsSuperAdmin($this->academy);
    expect(Entitlement::resolve($this->academy)['capabilities'])->not->toContain('modern_look');
    expect(DB::table('audit_log')->where('academy_id', $this->academy)->where('action', 'module_subscription.features')->count())->toBe(2);
});
