<?php

declare(strict_types=1);

use App\Support\PermissionCatalog;
use App\Support\PermissionResolver;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * SUPERVISOR — the academy manager who runs everything except the money.
 *
 * The promise under test is two-sided and both sides matter: a supervisor must actually be able to
 * run the academy (or the role is useless), and must not reach a single figure of money (or the
 * role is a lie). The second half includes READING: withholding the reprice button while still
 * printing the rate in the student list would hand back exactly what the role withholds.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);

    // A plan that carries every capability these endpoints are gated on, so the tests exercise
    // RBAC rather than the 402 upgrade gate.
    $planId = (string) Str::uuid();
    $this->asSuperAdmin();
    DB::table('plans')->insert([
        'id'          => $planId,
        'code'        => 'TEST_'.substr($planId, 0, 8),
        'name'        => 'Test Plan',
        'price_minor' => 0,
        'currency'    => 'EGP',
        'features'    => json_encode(['capabilities' => ['staff', 'custom_roles', 'payroll'], 'limits' => []]),
    ]);
    DB::table('academies')->where('id', $this->academy)->update(['plan_id' => $planId]);
    $this->clearTenantContext();

    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-sup@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup@test.local']);

    $this->guardian = $this->createGuardian($this->academy);
    $this->student = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Sara', 'status' => 'REGULAR']);
});

// ── The capability set itself ────────────────────────────────────────────────

it('grants the supervisor the academy floor and none of the money', function () {
    $caps = PermissionResolver::forRole('SUPERVISOR');

    // Runs the academy.
    expect($caps)
        ->toContain('student.read')->toContain('student.update')
        ->toContain('session.mark_attendance')->toContain('schedule.manage')
        ->toContain('teacher.update')->toContain('trial.manage')
        ->toContain('teacher_quality.manage')->toContain('certificate.manage');

    // Never touches the money — every FINANCIAL code, checked as a set so a capability added to
    // that list later cannot quietly slip into the role.
    expect(array_intersect($caps, PermissionCatalog::FINANCIAL))->toBe([]);

    // Nor hands out access: staff are visible, not editable, and roles are the owner's.
    expect($caps)
        ->toContain('staff.read')
        ->not->toContain('staff.create')->not->toContain('role.manage')
        ->not->toContain('user.invite')
        // The audit trail prints the prices and payments the role exists to withhold.
        ->not->toContain('audit.read');
});

// ── Doing the job ────────────────────────────────────────────────────────────

it('lets a supervisor run the academy', function () {
    Sanctum::actingAs($this->supervisor);

    $this->getJson('/api/students')->assertOk();
    $this->patchJson("/api/students/{$this->student}", ['full_name' => 'Sara Ahmed'])->assertOk();
    $this->getJson('/api/staff')->assertOk();
});

// ── Money: the write side ────────────────────────────────────────────────────

it('refuses to let a supervisor set or change what a student pays', function () {
    Sanctum::actingAs($this->supervisor);

    $this->putJson("/api/students/{$this->student}/subscription", [
        'plan_label'   => 'Hourly',
        'price_minor'  => 50000,
        'currency'     => 'EGP',
        'price_basis'  => 'PER_HOUR',
        'start_date'   => '2026-09-01',
    ])->assertForbidden();

    $this->getJson("/api/students/{$this->student}/subscription/reprice-preview")->assertForbidden();
});

it('refuses to let a supervisor price a student at enrolment', function () {
    Sanctum::actingAs($this->supervisor);

    // The create form takes an inline subscription; pricing there is still pricing.
    $this->postJson('/api/students', [
        'full_name'    => 'New Kid',
        'guardian_id'  => $this->guardian,
        'subscription' => [
            'plan_label'  => 'Hourly',
            'price_minor' => 50000,
            'currency'    => 'EGP',
            'price_basis' => 'PER_HOUR',
            'start_date'  => '2026-09-01',
        ],
    ])->assertForbidden();
});

it('keeps the invoices, the payroll and the profit out of reach', function () {
    Sanctum::actingAs($this->supervisor);

    $this->getJson('/api/invoices')->assertForbidden();
    $this->getJson('/api/payouts')->assertForbidden();
    $this->getJson('/api/reports/profit-summary')->assertForbidden();
});

// ── Money: the read side ─────────────────────────────────────────────────────

it('blanks the rate in the student list and detail for a supervisor', function () {
    // Price the student as the owner first, so there IS a rate to leak.
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/students/{$this->student}/subscription", [
        'plan_label'  => '8 hrs/month',
        'price_minor' => 50000,
        'currency'    => 'EGP',
        'price_basis' => 'PER_HOUR',
        'start_date'  => '2026-09-01',
    ])->assertOk();

    // The owner sees it.
    $ownerRow = collect($this->getJson('/api/students')->assertOk()->json('rows'))
        ->firstWhere('id', $this->student);
    expect($ownerRow['price_minor'])->toBe(50000);

    Sanctum::actingAs($this->supervisor);

    $row = collect($this->getJson('/api/students')->assertOk()->json('rows'))
        ->firstWhere('id', $this->student);
    // Present but empty — a missing key would read as "no subscription".
    expect($row)->toHaveKey('price_minor');
    expect($row['price_minor'])->toBeNull();
    expect($row['price_currency'])->toBeNull();
    // What the supervisor legitimately needs is untouched.
    expect($row['plan_label'])->toBe('8 hrs/month');
    expect($row['subscription_status'])->toBe('ACTIVE');

    $sub = $this->getJson("/api/students/{$this->student}")->assertOk()->json('subscription');
    expect($sub['price_minor'])->toBeNull();
    expect($sub['plan_label'])->toBe('8 hrs/month');
});

it('refuses to rank students by a rate the supervisor cannot see', function () {
    Sanctum::actingAs($this->supervisor);

    // Sorting by a blanked column would leak the ordering, so the key is not offered at all.
    $this->getJson('/api/students?sort=price')->assertStatus(422);

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/students?sort=price')->assertOk();
});

// ── Hiring one ───────────────────────────────────────────────────────────────

it('lets the owner create a supervisor login from the staff form', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson('/api/staff', [
        'full_name'    => 'Mahmoud Supervisor',
        'department'   => 'SUPPORT',
        'create_login' => true,
        'email'        => 'new-sup@test.local',
        'password'     => 'secret-password-1',
        'role'         => 'SUPERVISOR',
    ])->assertCreated();

    $userId = $res->json('userId');
    expect($userId)->toBeString();

    $this->asAcademy($this->academy);
    expect(DB::table('user_roles')->where('user_id', $userId)->value('role'))->toBe('SUPERVISOR');
});

it('still refuses to mint an owner or a teacher from the staff form', function () {
    Sanctum::actingAs($this->owner);

    foreach (['ACADEMY_OWNER', 'TEACHER', 'SUPER_ADMIN'] as $role) {
        $this->postJson('/api/staff', [
            'full_name'    => "Escalation {$role}",
            'department'   => 'SUPPORT',
            'create_login' => true,
            'email'        => strtolower($role).'-esc@test.local',
            'password'     => 'secret-password-1',
            'role'         => $role,
        ])->assertStatus(422);
    }
});

// ── The role builder ─────────────────────────────────────────────────────────

it('offers the supervisor as a starting point and marks what costs money', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->getJson('/api/roles')->assertOk();

    expect(collect($res->json('system'))->pluck('code')->all())->toContain('SUPERVISOR');

    // The preset an academy narrows down to build "supervisor, attendance only".
    $preset = collect($res->json('presets'))->firstWhere('key', 'supervisor');
    expect($preset['permissions'])->toContain('session.mark_attendance')->not->toContain('invoice.read');

    // The builder can show the owner which boxes hand over money.
    expect($res->json('financial'))
        ->toContain('invoice.read')->toContain('payout.adjust')->toContain('student.set_price')
        ->not->toContain('student.read');
});

// ── The pricing split did not strand anyone ─────────────────────────────────

it('leaves the owner able to price, since they always could', function () {
    expect(PermissionResolver::forRole('ACADEMY_OWNER'))->toContain('student.set_price');
});
