<?php

declare(strict_types=1);

use App\Models\User;
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
    $this->academy = $this->createAcademy();
});

// ── TC-2.4 / AC-2.10: /auth/me for an Owner ──────────────────────────────────
it('returns the Owner role, academy, and owner permission set', function () {
    $owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');
    Sanctum::actingAs($owner);

    $res = $this->getJson('/api/auth/me')->assertOk();

    $res->assertJsonPath('role', 'ACADEMY_OWNER');
    $res->assertJsonPath('academyId', $this->academy);
    expect($res->json('permissions'))
        ->toContain('invoice.mark_paid')
        ->toContain('student.create')
        ->not->toContain('academy.create'); // platform-only
});

// ── the panel's own identity travels with the session (docs/lms/02) ──────────
it('ships the academy name and logo the shell paints, and none for a platform admin', function () {
    $this->asSuperAdmin();
    DB::table('academies')->where('id', $this->academy)->update([
        'name' => 'Noor Academy',
        'brand_display_name' => 'Noor',
        'brand_logo_url' => 'https://cdn.test/noor.png',
    ]);

    Sanctum::actingAs($this->makeUser($this->academy, 'ACADEMY_OWNER'));
    $this->getJson('/api/auth/me')->assertOk()
        ->assertJsonPath('academy.name', 'Noor Academy')
        ->assertJsonPath('academy.displayName', 'Noor')
        ->assertJsonPath('academy.logoUrl', 'https://cdn.test/noor.png');

    // A platform Super Admin has no academy, so the chrome keeps the platform's own mark.
    Sanctum::actingAs($this->makeUser(null, 'SUPER_ADMIN'));
    $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('academy', null);
});

// ── the display name falls back to the academy's own name ────────────────────
it('falls back to the academy name when no brand name is set', function () {
    $this->asSuperAdmin();
    DB::table('academies')->where('id', $this->academy)->update([
        'name' => 'Al-Huda', 'brand_display_name' => null, 'brand_logo_url' => null,
    ]);

    Sanctum::actingAs($this->makeUser($this->academy, 'ACADEMY_OWNER'));
    $this->getJson('/api/auth/me')->assertOk()
        ->assertJsonPath('academy.displayName', 'Al-Huda')
        ->assertJsonPath('academy.logoUrl', null);
});

// ── TC-2.5 / AC-2.10: /auth/me for a Teacher (limited set) ───────────────────
it('returns the Teacher role and the limited permission set', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER');
    Sanctum::actingAs($teacher);

    $res = $this->getJson('/api/auth/me')->assertOk();

    $res->assertJsonPath('role', 'TEACHER');
    expect($res->json('permissions'))
        ->toContain('session.write_report')
        ->toContain('schedule.read')
        ->not->toContain('invoice.mark_paid')
        ->not->toContain('payout.read'); // only payout.read_own
});

// ── TC-2.6 / AC-2.10: /auth/me for a Super Admin (academyId null) ────────────
it('returns the Super Admin role with a null academyId', function () {
    $admin = $this->makeUser(null, 'SUPER_ADMIN');
    Sanctum::actingAs($admin);

    $this->getJson('/api/auth/me')
        ->assertOk()
        ->assertJsonPath('role', 'SUPER_ADMIN')
        ->assertJsonPath('academyId', null)
        ->assertJsonPath('locale', 'ar');
});

// ── TC-2.13 / AC-2.13: no session → 401, fail closed ─────────────────────────
it('rejects an unauthenticated /auth/me with 401', function () {
    $this->getJson('/api/auth/me')->assertUnauthorized();
});

// ── TC-2.11 / AC-2.13: an inactive user's session is rejected (401) ──────────
it('rejects an inactive user at the middleware (fail closed)', function () {
    $owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['is_active' => false]);
    Sanctum::actingAs($owner);

    $this->getJson('/api/auth/me')->assertUnauthorized();
});
