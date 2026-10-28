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

    // BUILDING is entitlement-gated (entitled:custom_roles): a client we switched it off for
    // gets a 402 upgrade response, not a 201.
    $this->postJson('/api/roles', [
        'name' => 'Front Desk',
        'permissions' => ['student.read'],
    ])->assertStatus(402);
    // LISTING stays free — the staff form needs the built-in STAFF/SUPERVISOR roles either way.
    expect(collect($this->getJson('/api/roles')->assertOk()->json('system'))->pluck('code')->all())->toContain('SUPERVISOR')->toContain('STAFF');
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
    // `invoicing` too: the builder only offers capabilities of modules the academy has.
    clientWith(['custom_roles', 'staff', 'invoicing'], $this->academy);
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

// ── Module clamp: only what this academy can actually use ─────────────────────

it('offers no capability for a module the academy does not have', function () {
    // A management client without video, LMS, CRM or invoicing.
    clientWith(['custom_roles', 'staff'], $this->academy);
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/roles')->assertOk();

    $grantable = $res->json('grantable');
    expect($grantable)->toContain('student.read')->toContain('session.mark_attendance')
        ->not->toContain('room.create')->not->toContain('recording.view')
        ->not->toContain('course.manage')->not->toContain('learner.read')
        ->not->toContain('crm.read')->not->toContain('invoice.read');

    // The system role cards say the same: a teacher's "join classroom" means nothing here.
    $teacher = collect($res->json('system'))->firstWhere('code', 'TEACHER');
    expect($teacher['permissions'])->toContain('session.mark_attendance')
        ->not->toContain('room.join')->not->toContain('recording.view');
});

it('refuses a hidden-module capability with a module message, not an escalation one', function () {
    clientWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/roles', ['name' => 'Classroom host', 'permissions' => ['room.create']])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('permissions')
        ->assertJsonFragment(['message' => 'These belong to a module this academy does not have: room.create / هذه الصلاحيات تتبع وحدة غير مفعّلة لدى الأكاديمية.']);
});

it('keeps a hidden-module capability a role already holds through an edit', function () {
    // The role was built while the academy had invoicing…
    clientWith(['custom_roles', 'invoicing'], $this->academy);
    Sanctum::actingAs($this->owner);
    $id = $this->postJson('/api/roles', [
        'name' => 'Front desk',
        'permissions' => ['student.read', 'invoice.read'],
    ])->assertCreated()->json('roleId');

    // …which is then switched off. The builder no longer shows invoice.read…
    clientWith(['custom_roles'], $this->academy);
    Sanctum::actingAs($this->owner);
    $role = collect($this->getJson('/api/roles')->assertOk()->json('custom'))->firstWhere('id', $id);
    expect($role['permissions'])->toBe(['student.read']);

    // …so an edit cannot mention it, and must not strip it either.
    $this->patchJson("/api/roles/{$id}", ['permissions' => ['student.read', 'guardian.read']])->assertOk();

    $code = collect($this->getJson('/api/roles')->json('custom'))->firstWhere('id', $id)['code'];
    expect(PermissionResolver::forRole($code))->toEqual(['guardian.read', 'invoice.read', 'student.read']);
});

// ── Editing a built-in role for one academy (academy_role_tunings) ───────────

it('edits the supervisor for this academy only, stored as a difference from the platform role', function () {
    clientWith(['custom_roles', 'payroll'], $this->academy);
    $other = $this->createAcademy();
    $supHere = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-here@test.local']);
    $supThere = $this->makeUser($other, 'SUPERVISOR', ['email' => 'sup-there@test.local']);

    Sanctum::actingAs($this->owner);
    $sup = collect($this->getJson('/api/roles')->assertOk()->json('system'))->firstWhere('code', 'SUPERVISOR');
    expect($sup['editable'])->toBeTrue()->and($sup['tuned'])->toBeFalse();

    // The builder shows only this academy's modules: the supervisor's invoice capabilities are
    // invisible here (no invoicing), so the edit cannot mention them — and must not strip them.
    expect($sup['permissions'])->not->toContain('invoice.mark_paid');
    $wanted = array_values(array_diff([...$sup['permissions'], 'payout.read'], ['student.deactivate']));
    $res = $this->putJson('/api/roles/system/SUPERVISOR', ['permissions' => $wanted])->assertOk();
    expect($res->json('added'))->toBe(['payout.read'])
        ->and($res->json('removed'))->toBe(['student.deactivate']);

    // This academy's supervisors hold the edited set on their next request…
    Sanctum::actingAs($supHere);
    expect($this->getJson('/api/auth/me')->assertOk()->json('permissions'))
        ->toContain('payout.read')->toContain('invoice.mark_paid')->toContain('student.update')
        ->not->toContain('student.deactivate');

    // …another academy's keep the role as it ships.
    Sanctum::actingAs($supThere);
    expect($this->getJson('/api/auth/me')->assertOk()->json('permissions'))
        ->not->toContain('payout.read')->toContain('student.deactivate');

    // The page says it was edited, and "back to default" undoes it.
    Sanctum::actingAs($this->owner);
    expect(collect($this->getJson('/api/roles')->json('system'))->firstWhere('code', 'SUPERVISOR')['tuned'])->toBeTrue();
    $this->deleteJson('/api/roles/system/SUPERVISOR')->assertOk();
    expect(collect($this->getJson('/api/roles')->json('system'))->firstWhere('code', 'SUPERVISOR')['tuned'])->toBeFalse();

    Sanctum::actingAs($supHere);
    expect($this->getJson('/api/auth/me')->json('permissions'))
        ->not->toContain('payout.read')->toContain('student.deactivate');
});

it('keeps the owner and the teacher fixed, and never lets an editor hand out what they lack', function () {
    clientWith(['custom_roles', 'payroll'], $this->academy);
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/roles/system/ACADEMY_OWNER', ['permissions' => ['student.read']])->assertNotFound();
    $this->putJson('/api/roles/system/TEACHER', ['permissions' => ['student.read']])->assertNotFound();
    expect(collect($this->getJson('/api/roles')->json('system'))->firstWhere('code', 'TEACHER')['editable'])->toBeFalse();

    // Someone trusted with roles but not with payroll cannot give supervisors the payroll.
    $code = $this->postJson('/api/roles', [
        'name' => 'Roles desk', 'permissions' => ['role.manage', 'student.read', 'session.read'],
    ])->assertCreated()->json('code');
    Sanctum::actingAs($this->makeUser($this->academy, $code, ['email' => 'roles-desk@test.local']));

    $this->putJson('/api/roles/system/SUPERVISOR', ['permissions' => ['student.read', 'session.read', 'payout.read']])
        ->assertStatus(422)->assertJsonValidationErrors('permissions');

    // What they cannot see is carried over, never stripped by their narrower view.
    $this->putJson('/api/roles/system/SUPERVISOR', ['permissions' => ['student.read', 'session.read']])
        ->assertOk()->assertJson(['added' => [], 'removed' => []]);
});
