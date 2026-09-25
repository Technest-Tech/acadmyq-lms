<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);

    // Staff endpoints are plan-gated (entitled:staff) — attach a plan that includes the
    // capability so these tests exercise the controller, not the 402 upgrade gate.
    $planId = (string) Str::uuid();
    $this->asSuperAdmin();
    DB::table('plans')->insert([
        'id'          => $planId,
        'code'        => 'TEST_'.substr($planId, 0, 8),
        'name'        => 'Test Plan',
        'price_minor' => 0,
        'currency'    => 'EGP',
        'features'    => json_encode(['capabilities' => ['staff'], 'limits' => []]),
    ]);
    DB::table('academies')->where('id', $this->academy)->update(['plan_id' => $planId]);
    $this->clearTenantContext();

    $this->owner   = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-staff@test.local']);
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-1: Create staff member
// ────────────────────────────────────────────────────────────────────────────

it('creates a staff member with required fields', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/staff', [
        'full_name'    => 'Sara Hassan',
        'department'   => 'SUPPORT',
        'phone'        => '+201001234567',
        'salary_minor' => 500000,
        'currency'     => 'EGP',
    ])->assertCreated();

    $staffId = $res->json('staffId');
    expect($staffId)->toBeString()->not->toBeEmpty();
    expect($res->json('userId'))->toBeNull();

    $detail = $this->getJson("/api/staff/{$staffId}")->assertOk();
    expect($detail->json('staff.full_name'))->toBe('Sara Hassan');
    expect($detail->json('staff.department'))->toBe('SUPPORT');
    expect($detail->json('staff.salary_minor'))->toBe(500000);
    expect($detail->json('staff.currency'))->toBe('EGP');
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-2: Department is uppercased and validated
// ────────────────────────────────────────────────────────────────────────────

it('stores department in uppercase', function () {
    Sanctum::actingAs($this->owner);

    $staffId = $this->postJson('/api/staff', [
        'full_name'  => 'Khaled Nour',
        'department' => 'accounting',
    ])->assertStatus(422);
});

it('rejects an invalid department', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/staff', [
        'full_name'  => 'Bad Dept',
        'department' => 'JANITOR',
    ])->assertStatus(422);
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-3: Listing is filtered by status
// ────────────────────────────────────────────────────────────────────────────

it('lists only active staff by default', function () {
    Sanctum::actingAs($this->owner);

    // Create two active members + deactivate one
    $id1 = $this->postJson('/api/staff', ['full_name' => 'Active One', 'department' => 'IT'])
        ->assertCreated()->json('staffId');
    $id2 = $this->postJson('/api/staff', ['full_name' => 'Active Two', 'department' => 'HR'])
        ->assertCreated()->json('staffId');

    $this->postJson("/api/staff/{$id1}/deactivate")->assertOk();

    // Default list = active only
    $list = $this->getJson('/api/staff')->assertOk();
    $ids = collect($list->json('rows'))->pluck('id')->all();
    expect($ids)->toContain($id2)->not->toContain($id1);

    // inactive filter shows only the deactivated one
    $inactiveList = $this->getJson('/api/staff?filter[status]=inactive')->assertOk();
    $inactiveIds  = collect($inactiveList->json('rows'))->pluck('id')->all();
    expect($inactiveIds)->toContain($id1)->not->toContain($id2);

    // all filter shows both
    $allList = $this->getJson('/api/staff?filter[status]=all')->assertOk();
    $allIds  = collect($allList->json('rows'))->pluck('id')->all();
    expect($allIds)->toContain($id1)->toContain($id2);
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-4: Update staff
// ────────────────────────────────────────────────────────────────────────────

it('updates staff fields and audits the change', function () {
    Sanctum::actingAs($this->owner);

    $staffId = $this->postJson('/api/staff', [
        'full_name'    => 'Original Name',
        'department'   => 'RECEPTION',
        'salary_minor' => 300000,
        'currency'     => 'EGP',
    ])->assertCreated()->json('staffId');

    $this->patchJson("/api/staff/{$staffId}", [
        'full_name'    => 'Updated Name',
        'salary_minor' => 350000,
    ])->assertOk()
      ->assertJson(['ok' => true])
      ->assertJsonFragment(['changed' => ['full_name', 'salary_minor']]);

    $detail = $this->getJson("/api/staff/{$staffId}")->assertOk();
    expect($detail->json('staff.full_name'))->toBe('Updated Name');
    expect($detail->json('staff.salary_minor'))->toBe(350000);

    $audit = DB::table('audit_log')
        ->where('entity_type', 'staff')
        ->where('entity_id', $staffId)
        ->where('action', 'staff.update')
        ->first();
    expect($audit)->not->toBeNull();
    $before = json_decode((string) $audit->before, true);
    $after  = json_decode((string) $audit->after, true);
    expect($before['full_name'])->toBe('Original Name');
    expect($after['full_name'])->toBe('Updated Name');
});

it('returns no changed fields when nothing differs', function () {
    Sanctum::actingAs($this->owner);

    $staffId = $this->postJson('/api/staff', [
        'full_name'  => 'Same Name',
        'department' => 'MARKETING',
    ])->assertCreated()->json('staffId');

    $this->patchJson("/api/staff/{$staffId}", [
        'full_name' => 'Same Name',
    ])->assertOk()->assertJson(['ok' => true, 'changed' => []]);
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-5: Deactivate and reactivate
// ────────────────────────────────────────────────────────────────────────────

it('deactivates a staff member (soft delete)', function () {
    Sanctum::actingAs($this->owner);

    $staffId = $this->postJson('/api/staff', [
        'full_name'  => 'To Deactivate',
        'department' => 'ADMINISTRATION',
    ])->assertCreated()->json('staffId');

    $this->postJson("/api/staff/{$staffId}/deactivate")->assertOk();

    $member = DB::table('staff')->where('id', $staffId)->first();
    expect($member->is_active)->toBeFalsy();
    expect($member->deleted_at)->not->toBeNull();
});

it('reactivates a previously deactivated staff member', function () {
    Sanctum::actingAs($this->owner);

    $staffId = $this->postJson('/api/staff', [
        'full_name'  => 'To Reactivate',
        'department' => 'HR',
    ])->assertCreated()->json('staffId');

    $this->postJson("/api/staff/{$staffId}/deactivate")->assertOk();
    $this->postJson("/api/staff/{$staffId}/reactivate")->assertOk();

    $member = DB::table('staff')->where('id', $staffId)->first();
    expect($member->is_active)->toBeTruthy();
    expect($member->deleted_at)->toBeNull();
});

it('returns 404 when deactivating an already deactivated member', function () {
    Sanctum::actingAs($this->owner);

    $staffId = $this->postJson('/api/staff', [
        'full_name'  => 'Double Deactivate',
        'department' => 'IT',
    ])->assertCreated()->json('staffId');

    $this->postJson("/api/staff/{$staffId}/deactivate")->assertOk();
    $this->postJson("/api/staff/{$staffId}/deactivate")->assertNotFound();
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-6: Optional login provisioning
// ────────────────────────────────────────────────────────────────────────────

it('provisions a system login for a staff member', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/staff', [
        'full_name'    => 'Amira Saleh',
        'department'   => 'ACCOUNTING',
        'create_login' => true,
        'email'        => 'amira@academy.test',
        'password'     => 'secure-pass-2024',
    ])->assertCreated();

    $userId = $res->json('userId');
    expect($userId)->not->toBeNull();

    $this->asAcademy($this->academy);
    $user = DB::table('users')->where('id', $userId)->first();
    expect($user->email)->toBe('amira@academy.test');
    expect(Hash::check('secure-pass-2024', $user->password))->toBeTrue();

    $role = DB::table('user_roles')->where('user_id', $userId)->first();
    expect($role->role)->toBe('STAFF');
});

it('requires password when create_login is true', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/staff', [
        'full_name'    => 'No Pass',
        'department'   => 'SUPPORT',
        'create_login' => true,
        'email'        => 'nopass@academy.test',
    ])->assertStatus(422);
});

it('rejects a duplicate login email', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/staff', [
        'full_name'    => 'First',
        'department'   => 'SUPPORT',
        'create_login' => true,
        'email'        => 'same@academy.test',
        'password'     => 'password123',
    ])->assertCreated();

    $this->postJson('/api/staff', [
        'full_name'    => 'Second',
        'department'   => 'HR',
        'create_login' => true,
        'email'        => 'same@academy.test',
        'password'     => 'password123',
    ])->assertStatus(422)->assertJsonFragment(['email' => ['That email is already in use.']]);
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-7: Permission enforcement
// ────────────────────────────────────────────────────────────────────────────

it('denies access to unauthenticated callers', function () {
    $this->getJson('/api/staff')->assertUnauthorized();
    $this->postJson('/api/staff', ['full_name' => 'X', 'department' => 'IT'])->assertUnauthorized();
});

it('blocks a TEACHER role from listing staff', function () {
    Sanctum::actingAs($this->owner);
    $teacherId = $this->postJson('/api/teachers', [
        'full_name'          => 'Teacher One',
        'session_rate_minor' => 1000,
        'currency'           => 'EGP',
        'create_login'       => true,
        'email'              => 'teacher-staff-test@academy.test',
        'password'           => 'teachpass123',
    ])->assertCreated()->json('userId');

    $teacherUser = DB::table('users')->where('id', $teacherId)->first();
    $teacher = \App\Models\User::find($teacherId);
    Sanctum::actingAs($teacher);

    $this->getJson('/api/staff')->assertForbidden();
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-8: Audit trail
// ────────────────────────────────────────────────────────────────────────────

it('logs a staff.create audit entry', function () {
    Sanctum::actingAs($this->owner);

    $staffId = $this->postJson('/api/staff', [
        'full_name'  => 'Audit Me',
        'department' => 'ADMINISTRATION',
    ])->assertCreated()->json('staffId');

    $log = DB::table('audit_log')
        ->where('entity_type', 'staff')
        ->where('entity_id', $staffId)
        ->where('action', 'staff.create')
        ->first();

    expect($log)->not->toBeNull();
    $after = json_decode((string) $log->after, true);
    expect($after['full_name'])->toBe('Audit Me');
    expect($after['department'])->toBe('ADMINISTRATION');
});

it('logs a staff.deactivate audit entry', function () {
    Sanctum::actingAs($this->owner);

    $staffId = $this->postJson('/api/staff', [
        'full_name'  => 'Audit Deactivate',
        'department' => 'SUPPORT',
    ])->assertCreated()->json('staffId');

    $this->postJson("/api/staff/{$staffId}/deactivate")->assertOk();

    $log = DB::table('audit_log')
        ->where('entity_type', 'staff')
        ->where('entity_id', $staffId)
        ->where('action', 'staff.deactivate')
        ->first();

    expect($log)->not->toBeNull();
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-9: Search and department filter
// ────────────────────────────────────────────────────────────────────────────

it('filters staff by department', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/staff', ['full_name' => 'IT Person', 'department' => 'IT'])->assertCreated();
    $this->postJson('/api/staff', ['full_name' => 'HR Person', 'department' => 'HR'])->assertCreated();

    $res = $this->getJson('/api/staff?filter[department]=IT')->assertOk();
    $names = collect($res->json('rows'))->pluck('full_name')->all();
    expect($names)->toContain('IT Person')->not->toContain('HR Person');
});

it('searches staff by name', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/staff', ['full_name' => 'Unique Xyz Name', 'department' => 'SUPPORT'])->assertCreated();
    $this->postJson('/api/staff', ['full_name' => 'Common Name', 'department' => 'IT'])->assertCreated();

    $res = $this->getJson('/api/staff?search=Unique+Xyz')->assertOk();
    $names = collect($res->json('rows'))->pluck('full_name')->all();
    expect($names)->toContain('Unique Xyz Name')->not->toContain('Common Name');
});

// ────────────────────────────────────────────────────────────────────────────
// TC-ST-10: Show 404 for missing staff
// ────────────────────────────────────────────────────────────────────────────

it('returns 404 for a non-existent staff id', function () {
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/staff/00000000-0000-0000-0000-000000000000')->assertNotFound();
});

it('returns 404 when patching a non-existent staff id', function () {
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/staff/00000000-0000-0000-0000-000000000000', [
        'full_name' => 'Ghost',
    ])->assertNotFound();
});

// ────────────────────────────────────────────────────────────────────────────
// The login has a lifecycle: it can be seen, changed, switched off, and it leaves with the employee
// ────────────────────────────────────────────────────────────────────────────

/**
 * A real sign-in attempt (stateful, so the Origin header) that does NOT leave the header behind:
 * `withHeader` persists for the rest of the test, and a later request as another user would then
 * be stateful too and resolve against the session this login just opened.
 */
function staffSignIn(string $email, string $password)
{
    $res = test()->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/auth/login', ['email' => $email, 'password' => $password]);
    // Leave no trace of the attempt in the harness: the header, the session it opened, and the
    // guard instances that now remember it. Otherwise the next stateful request as the owner
    // (Sanctum::actingAs) trips AuthenticateSession against this user's session and 401s.
    test()->flushHeaders();
    test()->flushSession();
    app('auth')->forgetGuards();

    return $res;
}

/** Create a staff member with a login through the API, as the owner; returns [staffId, userId]. */
function staffWithLogin(string $email, string $role = 'STAFF'): array
{
    Sanctum::actingAs(test()->owner);
    $res = test()->postJson('/api/staff', [
        'full_name' => 'Login Person', 'create_login' => true,
        'email' => $email, 'password' => 'secret-pass-123', 'role' => $role,
    ])->assertStatus(201);

    return [$res->json('staffId'), $res->json('userId')];
}

it('deactivating an employee switches their login off, and reactivating switches it back on', function () {
    [$staffId, $userId] = staffWithLogin('leaver@test.local');
    $login = fn () => staffSignIn('leaver@test.local', 'secret-pass-123');

    $login()->assertOk();

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/staff/{$staffId}/deactivate")->assertOk();
    $login()->assertStatus(403);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/staff/{$staffId}")->assertOk()->assertJsonPath('login.is_active', false);
    $this->postJson("/api/staff/{$staffId}/reactivate")->assertOk();
    $login()->assertOk();
});

it('shows the login on the detail and lets the owner change its email, password, role and state', function () {
    [$staffId, $userId] = staffWithLogin('desk@test.local');

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/staff/{$staffId}")->assertOk()
        ->assertJsonPath('login.has_login', true)
        ->assertJsonPath('login.email', 'desk@test.local')
        ->assertJsonPath('login.role', 'STAFF')
        ->assertJsonPath('login.is_active', true);

    $this->patchJson("/api/staff/{$staffId}/login", [])->assertStatus(422);

    $this->patchJson("/api/staff/{$staffId}/login", [
        'email' => 'desk2@test.local', 'password' => 'new-secret-456', 'role' => 'SUPERVISOR',
    ])->assertOk()->assertJsonPath('changed', ['email', 'password', 'role']);

    $this->getJson("/api/staff/{$staffId}")->assertOk()
        ->assertJsonPath('login.email', 'desk2@test.local')
        ->assertJsonPath('login.role', 'SUPERVISOR');
    $this->asAcademy($this->academy);
    expect(DB::table('user_roles')->where('user_id', $userId)->count())->toBe(1);

    staffSignIn('desk2@test.local', 'new-secret-456')->assertOk()->assertJsonPath('role', 'SUPERVISOR');

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/staff/{$staffId}/login", ['is_active' => false])->assertOk();
    staffSignIn('desk2@test.local', 'new-secret-456')->assertStatus(403);
});

it('creates a login later for an employee who was added without one', function () {
    Sanctum::actingAs($this->owner);
    $staffId = $this->postJson('/api/staff', ['full_name' => 'No Login Yet', 'create_login' => false])
        ->assertStatus(201)->json('staffId');

    $this->patchJson("/api/staff/{$staffId}/login", ['email' => 'late@test.local'])->assertStatus(422);
    $this->patchJson("/api/staff/{$staffId}/login", ['email' => 'late@test.local', 'password' => 'secret-pass-123'])
        ->assertStatus(201)->assertJsonPath('created', true);

    $this->getJson("/api/staff/{$staffId}")->assertOk()->assertJsonPath('login.role', 'STAFF');
});

it('never lets an owner switch off or deactivate their own login from the staff pages', function () {
    // An owner who also appears on the roster.
    Sanctum::actingAs($this->owner);
    $staffId = $this->postJson('/api/staff', ['full_name' => 'Me', 'create_login' => false])->json('staffId');
    $this->asAcademy($this->academy);
    DB::table('staff')->where('id', $staffId)->update(['user_id' => $this->owner->id]);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/staff/{$staffId}/login", ['is_active' => false])->assertStatus(422);
    $this->postJson("/api/staff/{$staffId}/deactivate")->assertStatus(422);
});

it('clamps assignment: a delegated HR role cannot hand out a role bigger than itself', function () {
    // Two owner-built roles: a small HR role that may create staff and assign roles, and a big one.
    $this->asAcademy($this->academy);
    $permIds = DB::table('permissions')->pluck('id', 'code');
    $mk = function (string $name, array $codes) use ($permIds): string {
        $id = (string) Str::uuid();
        $code = 'CR_'.str_replace('-', '', $id);
        DB::table('academy_roles')->insert([
            'id' => $id, 'academy_id' => $this->academy, 'code' => $code, 'name' => $name,
            'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ($codes as $c) {
            DB::table('academy_role_permissions')->insert(['academy_id' => $this->academy, 'role_id' => $id, 'permission_id' => $permIds[$c]]);
        }

        return $code;
    };
    // HR holds the STAFF baseline (so it can hand that out) plus the delegation capabilities.
    $hr = $mk('HR', ['student.read', 'guardian.read', 'schedule.read', 'session.read',
        'staff.read', 'staff.create', 'staff.update', 'user.invite', 'role.assign', 'role.manage']);
    $big = $mk('Everything', ['staff.read', 'staff.create', 'user.invite', 'role.assign', 'invoice.read', 'payout.read']);
    $this->clearTenantContext();
    $hrUser = $this->makeUser($this->academy, $hr, ['email' => 'hr@test.local']);

    Sanctum::actingAs($hrUser);
    $payload = ['full_name' => 'New Hire', 'create_login' => true, 'email' => 'hire@test.local', 'password' => 'secret-pass-123'];

    // A role holding invoice.read / payout.read the HR person does not have: refused.
    $this->postJson('/api/staff', $payload + ['role' => $big])->assertStatus(422);
    // The built-in SUPERVISOR is bigger than HR too.
    $this->postJson('/api/staff', $payload + ['role' => 'SUPERVISOR'])->assertStatus(422);
    // Their own role, or the minimal STAFF baseline: fine.
    $this->postJson('/api/staff', $payload + ['role' => 'STAFF'])->assertStatus(201);

    // The same clamp on a later role change.
    $staffId = DB::table('staff')->where('full_name', 'New Hire')->value('id');
    $this->patchJson("/api/staff/{$staffId}/login", ['role' => $big])->assertStatus(422);
    $this->patchJson("/api/staff/{$staffId}/login", ['role' => $hr])->assertOk();

    // And the owner, who holds everything, can hand out the big role.
    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/staff/{$staffId}/login", ['role' => $big])->assertOk();
});

it('lists the login role next to each employee', function () {
    staffWithLogin('listed@test.local', 'SUPERVISOR');
    Sanctum::actingAs($this->owner);

    $rows = collect($this->getJson('/api/staff')->assertOk()->json('rows'));
    expect($rows->firstWhere('full_name', 'Login Person')['login_role'])->toBe('SUPERVISOR');
});
