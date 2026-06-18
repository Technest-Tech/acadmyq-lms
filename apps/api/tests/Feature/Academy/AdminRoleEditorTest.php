<?php

declare(strict_types=1);

use App\Support\PermissionResolver;
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
    $this->owner = $this->makeUser($this->A, 'ACADEMY_OWNER');
});

// ── Lists every role with its current capabilities + the catalog ──────────────
it('lists roles with their capabilities and the full catalog', function () {
    Sanctum::actingAs($this->admin);
    $res = $this->getJson('/api/admin/roles')->assertOk();

    $res->assertJsonStructure(['roles' => [['role', 'permissions']], 'catalog', 'lockoutCritical']);
    $owner = collect($res->json('roles'))->firstWhere('role', 'ACADEMY_OWNER');
    expect($owner['permissions'])->toContain('student.read');
    expect($res->json('catalog'))->toContain('platform.manage');
});

// ── Editing a role's capabilities changes what its users resolve ──────────────
it('grants a capability to a role and it appears in resolution', function () {
    $this->asSuperAdmin();
    expect(PermissionResolver::forRole('TEACHER'))->not->toContain('certificate.read');

    Sanctum::actingAs($this->admin);
    $current = PermissionResolver::forRole('TEACHER');
    $this->patchJson('/api/admin/roles/TEACHER/permissions', [
        'permissions' => [...$current, 'certificate.read'],
    ])->assertOk();

    $this->asSuperAdmin();
    expect(PermissionResolver::forRole('TEACHER'))->toContain('certificate.read');
    expect(DB::table('audit_log')->where('action', 'platform.role_permissions')->exists())->toBeTrue();
});

// ── Revoking a capability removes it from resolution ──────────────────────────
it('revokes a capability from a role', function () {
    Sanctum::actingAs($this->admin);
    $current = PermissionResolver::forRole('ACADEMY_OWNER');
    $without = array_values(array_diff($current, ['certificate.manage']));
    $this->patchJson('/api/admin/roles/ACADEMY_OWNER/permissions', [
        'permissions' => $without,
    ])->assertOk();

    $this->asSuperAdmin();
    expect(PermissionResolver::forRole('ACADEMY_OWNER'))->not->toContain('certificate.manage');
});

// ── Lockout guard: SUPER_ADMIN must keep platform.manage ──────────────────────
it('refuses to strip platform.manage from SUPER_ADMIN', function () {
    Sanctum::actingAs($this->admin);
    $current = PermissionResolver::forRole('SUPER_ADMIN');
    $without = array_values(array_diff($current, ['platform.manage']));

    $this->patchJson('/api/admin/roles/SUPER_ADMIN/permissions', [
        'permissions' => $without,
    ])->assertStatus(422);

    // The mapping is unchanged.
    $this->asSuperAdmin();
    expect(PermissionResolver::forRole('SUPER_ADMIN'))->toContain('platform.manage');
});

// ── Validation: unknown role / unknown capability ─────────────────────────────
it('rejects an unknown role and an unknown capability', function () {
    Sanctum::actingAs($this->admin);
    $this->patchJson('/api/admin/roles/WIZARD/permissions', ['permissions' => []])->assertStatus(404);

    Sanctum::actingAs($this->admin);
    $this->patchJson('/api/admin/roles/TEACHER/permissions', [
        'permissions' => ['not.a.real.capability'],
    ])->assertStatus(422);
});

// ── Two-layer authz ───────────────────────────────────────────────────────────
it('forbids an Owner from the role editor', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/admin/roles')->assertForbidden();
    $this->patchJson('/api/admin/roles/TEACHER/permissions', ['permissions' => []])->assertForbidden();
});
