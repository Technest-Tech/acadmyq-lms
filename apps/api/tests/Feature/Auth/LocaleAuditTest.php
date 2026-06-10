<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->A = $this->createAcademy();
    $this->owner = $this->makeUser($this->A, 'ACADEMY_OWNER');
});

// ── TC-2.25 / AC-2.11: a new user defaults to Arabic (RTL) ───────────────────
it('defaults a new user to Arabic', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('locale', 'ar');
});

// ── TC-2.24 / AC-2.11: switching to English persists and flips direction ─────
it('persists an English locale choice and reports LTR direction', function () {
    Sanctum::actingAs($this->owner);

    $this->patchJson('/api/auth/locale', ['locale' => 'en'])
        ->assertOk()
        ->assertJsonPath('locale', 'en')
        ->assertJsonPath('dir', 'ltr');

    // Persisted on the users row (survives re-login).
    $this->asAcademy($this->A);
    expect(DB::table('users')->where('id', $this->owner->id)->value('preferred_locale'))->toBe('en');
});

// ── TC-2.25 / AC-2.11: switching back to Arabic flips to RTL ──────────────────
it('switches back to Arabic and reports RTL direction', function () {
    Sanctum::actingAs($this->owner);

    $this->patchJson('/api/auth/locale', ['locale' => 'ar'])
        ->assertOk()
        ->assertJsonPath('dir', 'rtl');
});

// ── TC-2.28 / R-AUD-1: role assignment writes a role.assigned audit entry ────
it('records a role.assigned audit entry from the seeder', function () {
    // Read the demo academy's audit rows as a Super Admin who has entered it.
    $this->asSuperAdmin();
    $demo = DB::table('academies')->where('subdomain', 'noor')->value('id');
    $this->enterAcademyAsSuperAdmin($demo);

    expect(DB::table('audit_log')
        ->where('action', 'role.assigned')
        ->where('entity_type', 'user_role')
        ->exists())->toBeTrue();
});
