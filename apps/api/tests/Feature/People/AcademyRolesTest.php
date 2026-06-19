<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/** Attach a plan granting $capabilities to the test academy (Super-Admin catalog write). */
function planWith(array $capabilities, string $academyId): void
{
    $planId = (string) Str::uuid();
    test()->asSuperAdmin();
    DB::table('plans')->insert([
        'id'          => $planId,
        'code'        => 'TEST_'.substr($planId, 0, 8),
        'name'        => 'Test Plan',
        'price_minor' => 0,
        'currency'    => 'EGP',
        'features'    => json_encode(['capabilities' => $capabilities, 'limits' => []]),
    ]);
    DB::table('academies')->where('id', $academyId)->update(['plan_id' => $planId]);
    test()->clearTenantContext();
}

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner   = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-roles@test.local']);
});

// ── Listing (free; not plan-gated) ───────────────────────────────────────────

it('lists the assignable system roles and grantable capabilities', function () {
    planWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/roles')->assertOk();

    $systemCodes = collect($res->json('system'))->pluck('code')->all();
    expect($systemCodes)->toContain('STAFF')->toContain('TEACHER')->toContain('ACADEMY_OWNER');

    // Grantable = the owner's own academy-scoped capabilities (never platform caps).
    $grantable = $res->json('grantable');
    expect($grantable)->toContain('student.read')->not->toContain('platform.manage')->not->toContain('academy.create');
});

// ── Create (plan-gated by custom_roles) ──────────────────────────────────────

it('creates a custom role and resolves its capabilities', function () {
    planWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/roles', [
        'name'        => 'Receptionist',
        'description' => 'Front desk',
        'permissions' => ['student.read', 'guardian.read'],
    ])->assertCreated();

    $code = $res->json('code');
    expect($code)->toStartWith('CR_');

    // The unified resolver returns exactly the granted capabilities for the new code.
    $caps = \App\Support\PermissionResolver::forRole($code);
    expect($caps)->toEqual(['guardian.read', 'student.read']);
});

it('blocks granting a capability the owner does not hold (no escalation)', function () {
    planWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/roles', [
        'name'        => 'Sneaky Admin',
        'permissions' => ['platform.manage'],
    ])->assertStatus(422);
});

it('blocks the roles module on a plan without custom_roles (402 upgrade)', function () {
    planWith(['staff'], $this->academy); // no custom_roles capability (e.g. BASIC)
    Sanctum::actingAs($this->owner);

    // The module is plan-gated (entitled:custom_roles — FREE-trial & PRO only): an academy whose
    // plan omits it gets a 402 upgrade response, not a 201.
    $this->postJson('/api/roles', [
        'name'        => 'Front Desk',
        'permissions' => ['student.read'],
    ])->assertStatus(402);
    $this->getJson('/api/roles')->assertStatus(402);
});

// ── Update ───────────────────────────────────────────────────────────────────

it('updates a custom role name and re-grants permissions', function () {
    planWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $roleId = $this->postJson('/api/roles', [
        'name'        => 'Desk',
        'permissions' => ['student.read'],
    ])->assertCreated()->json('roleId');

    $this->patchJson("/api/roles/{$roleId}", [
        'name'        => 'Front Desk',
        'permissions' => ['student.read', 'guardian.read', 'schedule.read'],
    ])->assertOk();

    $row = DB::table('academy_roles')->where('id', $roleId)->first();
    expect($row->name)->toBe('Front Desk');
    expect(\App\Support\PermissionResolver::forRole($row->code))
        ->toEqual(['guardian.read', 'schedule.read', 'student.read']);
});

// ── Assigning a custom role to a staff login ─────────────────────────────────

it('assigns a custom role to a staff member login', function () {
    planWith(['custom_roles', 'staff'], $this->academy);
    Sanctum::actingAs($this->owner);

    $code = $this->postJson('/api/roles', [
        'name'        => 'Accountant',
        'permissions' => ['invoice.read'],
    ])->assertCreated()->json('code');

    $userId = $this->postJson('/api/staff', [
        'full_name'    => 'Mona Accountant',
        'department'   => 'ACCOUNTING',
        'create_login' => true,
        'email'        => 'mona@academy.test',
        'password'     => 'secure-pass-2024',
        'role'         => $code,
    ])->assertCreated()->json('userId');

    $this->asAcademy($this->academy);
    $assigned = DB::table('user_roles')->where('user_id', $userId)->value('role');
    expect($assigned)->toBe($code);
});

it('rejects an unknown role code on staff login provisioning', function () {
    planWith(['custom_roles', 'staff'], $this->academy);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/staff', [
        'full_name'    => 'Bad Role',
        'department'   => 'SUPPORT',
        'create_login' => true,
        'email'        => 'badrole@academy.test',
        'password'     => 'secure-pass-2024',
        'role'         => 'ACADEMY_OWNER', // privileged system code is not assignable here
    ])->assertStatus(422);
});

// ── Delete ────────────────────────────────────────────────────────────────────

it('refuses to delete a role that is still assigned', function () {
    planWith(['custom_roles', 'staff'], $this->academy);
    Sanctum::actingAs($this->owner);

    $created = $this->postJson('/api/roles', [
        'name'        => 'In Use',
        'permissions' => ['student.read'],
    ])->assertCreated();
    $roleId = $created->json('roleId');
    $code   = $created->json('code');

    $this->postJson('/api/staff', [
        'full_name'    => 'Holder',
        'department'   => 'SUPPORT',
        'create_login' => true,
        'email'        => 'holder@academy.test',
        'password'     => 'secure-pass-2024',
        'role'         => $code,
    ])->assertCreated();

    $this->deleteJson("/api/roles/{$roleId}")->assertStatus(422);
});

it('deletes an unused custom role and cascades its grants', function () {
    planWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $roleId = $this->postJson('/api/roles', [
        'name'        => 'Temp',
        'permissions' => ['student.read', 'guardian.read'],
    ])->assertCreated()->json('roleId');

    $this->deleteJson("/api/roles/{$roleId}")->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('academy_roles')->where('id', $roleId)->exists())->toBeFalse();
    expect(DB::table('academy_role_permissions')->where('role_id', $roleId)->count())->toBe(0);
});

// ── Authorization ─────────────────────────────────────────────────────────────

it('denies a user without role.manage', function () {
    planWith(['custom_roles'], $this->academy);
    // A teacher login holds no role.manage capability.
    $teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-roles@test.local']);
    Sanctum::actingAs($teacher);

    $this->getJson('/api/roles')->assertForbidden();
});
