<?php

declare(strict_types=1);

use App\Services\ModuleBilling;
use App\Support\FeatureCatalog;
use App\Support\PermissionResolver;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Leave the client holding exactly $capabilities from its management module — everything else is
 * switched off in its profile (05-MODULES-NOT-PACKAGES §4: a module grants all it owns; the client's
 * own switches are the only exception).
 */
function clientWith(array $capabilities, string $academyId): void
{
    test()->asAcademy($academyId, 'SUPER_ADMIN');
    app(ModuleBilling::class)->setDisabledFeatures(
        $academyId,
        'MANAGEMENT',
        array_values(array_diff(FeatureCatalog::capabilitiesOfModule('MANAGEMENT'), $capabilities)),
    );
    test()->clearTenantContext();
}

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-roles@test.local']);
});

// ── Listing (free; not plan-gated) ───────────────────────────────────────────

it('lists the assignable system roles and grantable capabilities', function () {
    clientWith(['custom_roles'], $this->academy);
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
    clientWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/roles', [
        'name' => 'Receptionist',
        'description' => 'Front desk',
        'permissions' => ['student.read', 'guardian.read'],
    ])->assertCreated();

    $code = $res->json('code');
    expect($code)->toStartWith('CR_');

    // The unified resolver returns exactly the granted capabilities for the new code.
    $caps = PermissionResolver::forRole($code);
    expect($caps)->toEqual(['guardian.read', 'student.read']);
});

it('blocks granting a capability the owner does not hold (no escalation)', function () {
    clientWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/roles', [
        'name' => 'Sneaky Admin',
        'permissions' => ['platform.manage'],
    ])->assertStatus(422);
});

it('blocks the roles module for a client whose custom_roles we switched off (402 upgrade)', function () {
    clientWith(['staff'], $this->academy); // custom_roles switched off for this client
    Sanctum::actingAs($this->owner);

    // The module is entitlement-gated (entitled:custom_roles): a client we switched it off for
    // gets a 402 upgrade response, not a 201.
    $this->postJson('/api/roles', [
        'name' => 'Front Desk',
        'permissions' => ['student.read'],
    ])->assertStatus(402);
    $this->getJson('/api/roles')->assertStatus(402);
});

// ── Update ───────────────────────────────────────────────────────────────────

it('updates a custom role name and re-grants permissions', function () {
    clientWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $roleId = $this->postJson('/api/roles', [
        'name' => 'Desk',
        'permissions' => ['student.read'],
    ])->assertCreated()->json('roleId');

    $this->patchJson("/api/roles/{$roleId}", [
        'name' => 'Front Desk',
        'permissions' => ['student.read', 'guardian.read', 'schedule.read'],
    ])->assertOk();

    $row = DB::table('academy_roles')->where('id', $roleId)->first();
    expect($row->name)->toBe('Front Desk');
    expect(PermissionResolver::forRole($row->code))
        ->toEqual(['guardian.read', 'schedule.read', 'student.read']);
});

// ── Assigning a custom role to a staff login ─────────────────────────────────

it('assigns a custom role to a staff member login', function () {
    clientWith(['custom_roles', 'staff'], $this->academy);
    Sanctum::actingAs($this->owner);

    $code = $this->postJson('/api/roles', [
        'name' => 'Accountant',
        'permissions' => ['invoice.read'],
    ])->assertCreated()->json('code');

    $userId = $this->postJson('/api/staff', [
        'full_name' => 'Mona Accountant',
        'department' => 'ACCOUNTING',
        'create_login' => true,
        'email' => 'mona@academy.test',
        'password' => 'secure-pass-2024',
        'role' => $code,
    ])->assertCreated()->json('userId');

    $this->asAcademy($this->academy);
    $assigned = DB::table('user_roles')->where('user_id', $userId)->value('role');
    expect($assigned)->toBe($code);
});

it('rejects an unknown role code on staff login provisioning', function () {
    clientWith(['custom_roles', 'staff'], $this->academy);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/staff', [
        'full_name' => 'Bad Role',
        'department' => 'SUPPORT',
        'create_login' => true,
        'email' => 'badrole@academy.test',
        'password' => 'secure-pass-2024',
        'role' => 'ACADEMY_OWNER', // privileged system code is not assignable here
    ])->assertStatus(422);
});

// ── Delete ────────────────────────────────────────────────────────────────────

it('refuses to delete a role that is still assigned', function () {
    clientWith(['custom_roles', 'staff'], $this->academy);
    Sanctum::actingAs($this->owner);

    $created = $this->postJson('/api/roles', [
        'name' => 'In Use',
        'permissions' => ['student.read'],
    ])->assertCreated();
    $roleId = $created->json('roleId');
    $code = $created->json('code');

    $this->postJson('/api/staff', [
        'full_name' => 'Holder',
        'department' => 'SUPPORT',
        'create_login' => true,
        'email' => 'holder@academy.test',
        'password' => 'secure-pass-2024',
        'role' => $code,
    ])->assertCreated();

    $this->deleteJson("/api/roles/{$roleId}")->assertStatus(422);
});

it('deletes an unused custom role and cascades its grants', function () {
    clientWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $roleId = $this->postJson('/api/roles', [
        'name' => 'Temp',
        'permissions' => ['student.read', 'guardian.read'],
    ])->assertCreated()->json('roleId');

    $this->deleteJson("/api/roles/{$roleId}")->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('academy_roles')->where('id', $roleId)->exists())->toBeFalse();
    expect(DB::table('academy_role_permissions')->where('role_id', $roleId)->count())->toBe(0);
});

// ── Authorization ─────────────────────────────────────────────────────────────

it('denies a user without role.manage', function () {
    clientWith(['custom_roles'], $this->academy);
    // A teacher login holds no role.manage capability.
    $teacher = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-roles@test.local']);
    Sanctum::actingAs($teacher);

    $this->getJson('/api/roles')->assertForbidden();
});
