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

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->A = $this->createAcademy();
    $this->B = $this->createAcademy();
    $this->ownerA = $this->makeUser($this->A, 'ACADEMY_OWNER', ['full_name' => 'Owner Alpha', 'email' => 'alpha@a.test']);
    $this->ownerB = $this->makeUser($this->B, 'ACADEMY_OWNER', ['full_name' => 'Owner Beta', 'email' => 'beta@b.test']);
    $this->teacherA = $this->makeUser($this->A, 'TEACHER', ['email' => 'teach@a.test']);
});

// ── Platform list spans every academy ─────────────────────────────────────────
it('lists users across all academies for a Super Admin', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->getJson('/api/admin/users')->assertOk();
    $res->assertJsonStructure(['rows' => [['id', 'full_name', 'email', 'is_active', 'academy_id', 'academy_name', 'roles']], 'total', 'page', 'pageSize']);

    $emails = collect($res->json('rows'))->pluck('email');
    expect($emails)->toContain('alpha@a.test')->toContain('beta@b.test');
});

// ── Filters: academy, role, search ────────────────────────────────────────────
it('filters users by academy', function () {
    Sanctum::actingAs($this->admin);
    $rows = $this->getJson("/api/admin/users?academy={$this->B}")->assertOk()->json('rows');

    expect(collect($rows)->pluck('email'))->toContain('beta@b.test')
        ->not->toContain('alpha@a.test');
});

it('filters users by role and by search term', function () {
    Sanctum::actingAs($this->admin);

    $teachers = $this->getJson('/api/admin/users?role=TEACHER')->assertOk()->json('rows');
    expect(collect($teachers)->pluck('email'))->toContain('teach@a.test')
        ->not->toContain('alpha@a.test');

    Sanctum::actingAs($this->admin);
    $hit = $this->getJson('/api/admin/users?search=Alpha')->assertOk()->json('rows');
    expect(collect($hit)->pluck('email'))->toContain('alpha@a.test')
        ->not->toContain('beta@b.test');
});

// ── Detail returns roles across academies ─────────────────────────────────────
it('returns a user detail with roles', function () {
    Sanctum::actingAs($this->admin);
    $res = $this->getJson("/api/admin/users/{$this->ownerA->id}")->assertOk();

    expect($res->json('user.email'))->toBe('alpha@a.test')
        ->and(collect($res->json('user.roles'))->pluck('role'))->toContain('ACADEMY_OWNER');
});

// ── Deactivate blocks login; reactivate restores it ───────────────────────────
it('deactivates a user and blocks their login, then reactivates', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/users/{$this->ownerA->id}/deactivate")->assertOk();

    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('users')->where('id', $this->ownerA->id)->value('is_active'))->toBeFalse();

    // login is refused while inactive (stateful login needs the Origin header)
    $this->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/auth/login', ['email' => 'alpha@a.test', 'password' => 'password'])
        ->assertStatus(403);

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/users/{$this->ownerA->id}/reactivate")->assertOk();
    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('users')->where('id', $this->ownerA->id)->value('is_active'))->toBeTrue();
});

it('refuses to deactivate the acting Super Admin themselves', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/users/{$this->admin->id}/deactivate")->assertStatus(422);
});

// ── Role assign / revoke is audited and tenant-scoped ─────────────────────────
it('grants and revokes a role in an academy, audited', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/users/{$this->teacherA->id}/roles", [
        'academy_id' => $this->A, 'role' => 'ACADEMY_OWNER', 'grant' => true,
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('user_roles')->where('user_id', $this->teacherA->id)->where('role', 'ACADEMY_OWNER')->exists())->toBeTrue();
    expect(DB::table('audit_log')->where('action', 'role.assign')->where('entity_id', $this->teacherA->id)->exists())->toBeTrue();

    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/users/{$this->teacherA->id}/roles", [
        'academy_id' => $this->A, 'role' => 'ACADEMY_OWNER', 'grant' => false,
    ])->assertOk();

    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('user_roles')->where('user_id', $this->teacherA->id)->where('role', 'ACADEMY_OWNER')->exists())->toBeFalse();
    expect(DB::table('audit_log')->where('action', 'role.revoke')->where('entity_id', $this->teacherA->id)->exists())->toBeTrue();
});

// ── Reset password is audited ─────────────────────────────────────────────────
it('sends a password reset and audits it', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/users/{$this->ownerA->id}/reset-password")->assertOk();

    $this->enterAcademyAsSuperAdmin($this->A);
    expect(DB::table('audit_log')->where('action', 'user.reset_password')->where('entity_id', $this->ownerA->id)->exists())->toBeTrue();
});

// ── Two-layer authz: non-super roles are forbidden everywhere ─────────────────
it('forbids an Owner from every admin user endpoint', function () {
    Sanctum::actingAs($this->ownerA);

    $this->getJson('/api/admin/users')->assertForbidden();
    $this->getJson("/api/admin/users/{$this->ownerB->id}")->assertForbidden();
    $this->postJson("/api/admin/users/{$this->ownerB->id}/deactivate")->assertForbidden();
    $this->postJson("/api/admin/users/{$this->ownerB->id}/roles", [
        'academy_id' => $this->B, 'role' => 'TEACHER', 'grant' => true,
    ])->assertForbidden();
});
