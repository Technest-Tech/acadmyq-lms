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
