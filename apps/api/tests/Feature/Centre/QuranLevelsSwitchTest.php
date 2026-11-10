<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use App\Support\FeatureCatalog;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Levels for a Quran academy, if it wants them (2026-11-10). Pinned here:
 *   - off by default: the session says so and the levels routes answer 402 as they always did;
 *   - the academy switches it on itself (PATCH /academy levels_enabled — the supervisor who keeps
 *     the catalogue may), and then keeps a list and puts students on it;
 *   - off again hides the routes, and nothing is lost: the student keeps their level;
 *   - a centre has levels whatever the switch says.
 * Also the `courses_art` banner picture: an opt-in of the management module, like `modern_look`.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['name' => 'EnglishSpirit', 'country' => 'EG', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-qls@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-qls@test.local']);
    $parent = $this->createGuardian($this->academy, ['full_name' => 'Umm Doaa', 'whatsapp_phone' => '+201001112299']);
    $this->student = $this->createStudent($this->academy, $parent, ['full_name' => 'Doaa']);
    $this->clearTenantContext();
});

it('keeps levels off for a Quran academy until it switches them on, and keeps every level when switched off', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.levelsEnabled', false);
    $this->getJson('/api/academy')->assertOk()->assertJsonPath('academy.levels_enabled', false);
    $this->getJson('/api/levels')->assertStatus(402);

    Sanctum::actingAs($this->supervisor);
    $this->patchJson('/api/academy', ['levels_enabled' => true])->assertOk();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.levelsEnabled', true);
    $this->getJson('/api/levels')->assertOk();
    $level = (string) $this->postJson('/api/levels', ['name' => 'تأسيس'])->assertCreated()->json('levelId');
    $this->patchJson("/api/students/{$this->student}", ['level_id' => $level])->assertOk();
    $this->getJson("/api/students/{$this->student}")->assertOk()->assertJsonPath('student.level_name', 'تأسيس');

    $this->patchJson('/api/academy', ['levels_enabled' => false])->assertOk();
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.levelsEnabled', false);
    $this->getJson('/api/levels')->assertStatus(402);
    $this->asAcademy($this->academy);
    expect((string) DB::table('students')->where('id', $this->student)->value('level_id'))->toBe($level);
});

it('writes only the switch, and refuses a non-boolean', function () {
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/academy', ['levels_enabled' => 'maybe'])->assertStatus(422)->assertJsonValidationErrors(['levels_enabled']);
    $this->patchJson('/api/academy', ['levels_enabled' => true])->assertOk();
    $this->getJson('/api/academy')->assertOk()
        ->assertJsonPath('academy.name', 'EnglishSpirit')
        ->assertJsonPath('academy.country', 'EG')
        ->assertJsonPath('academy.default_currency', 'EGP')
        ->assertJsonPath('academy.levels_enabled', true);
});

it('gives a centre its levels whatever the switch says', function () {
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$this->academy]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    app(ModuleBilling::class)->setDisabledFeatures($this->academy, 'MANAGEMENT', [], ['centre']);
    DB::statement("select set_config('app.current_academy_id', '', true)");
    DB::statement("select set_config('app.current_role', '', true)");

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy.levelsEnabled', true);
    $this->getJson('/api/levels')->assertOk();
});

it('offers the courses picture as an opt-in of the management module', function () {
    expect(FeatureCatalog::capabilitiesOfModule('MANAGEMENT'))->toContain('courses_art')
        ->and(FeatureCatalog::OPT_IN_CAPABILITIES)->toContain('courses_art');

    Sanctum::actingAs($this->owner);
    expect($this->getJson('/api/auth/me')->assertOk()->json('capabilities'))->not->toContain('courses_art');
});
