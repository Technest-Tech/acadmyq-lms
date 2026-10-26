<?php

declare(strict_types=1);

use App\Support\PermissionCatalog;
use App\Support\PermissionResolver;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * The team & permissions rework: the shared built-in roles (MANAGER, SUPERVISOR, ACCOUNTANT,
 * CUSTOMER_SERVICE, STAFF), the builder's sections, and the money/statistics leaks closed for the
 * supervisor — teacher pay, staff salaries, the charge/pay call on a cancellation, quality money,
 * package alerts, the performance dashboards and the academy's own switches.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-team@test.local']);
    $this->supervisor = $this->makeUser($this->academy, 'SUPERVISOR', ['email' => 'sup-team@test.local']);
    $this->accountant = $this->makeUser($this->academy, 'ACCOUNTANT', ['email' => 'acc-team@test.local']);
    $this->frontDesk = $this->makeUser($this->academy, 'CUSTOMER_SERVICE', ['email' => 'desk-team@test.local']);

    $this->teacher = $this->createTeacher($this->academy, [
        'full_name' => 'Rate Teacher', 'session_rate_minor' => 12000, 'currency' => 'EGP',
    ]);
    $this->student = $this->createStudent($this->academy);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

// ── The catalog ──────────────────────────────────────────────────────────────

it('files every academy capability under exactly one builder section', function () {
    $filed = [];
    foreach (PermissionCatalog::AREAS as $area) {
        foreach ([...$area['view'], ...$area['manage']] as $code) {
            $filed[] = $code;
        }
    }

    $owner = PermissionCatalog::roleMap()['ACADEMY_OWNER'];
    expect(array_values(array_diff($owner, $filed)))->toBe([])
        ->and(array_values(array_diff($filed, $owner)))->toBe([])
        ->and(count($filed))->toBe(count(array_unique($filed)));
});

it('draws the shared roles where the owner expects them', function () {
    $map = PermissionCatalog::roleMap();

    // Supervisor: the day-to-day, enrolling people with their prices — never the money desk,
    // statistics or the academy's switches.
    expect(array_values(array_intersect($map['SUPERVISOR'], PermissionCatalog::FINANCIAL)))
        ->toEqualCanonicalizing(['student.set_price', 'package.read', 'package.manage', 'teacher.set_pay'])
        ->and(array_intersect($map['SUPERVISOR'], PermissionCatalog::STATISTICS))->toBe([])
        ->and($map['SUPERVISOR'])->not->toContain('settings.manage')->toContain('session.follow');

    // Manager: everything the owner has.
    expect($map['MANAGER'])->toEqualCanonicalizing($map['ACADEMY_OWNER']);

    // Accountant: the money desk, read-only on the operation.
    expect($map['ACCOUNTANT'])->toContain('invoice.mark_paid')->toContain('payout.finalize')
        ->toContain('teacher.set_pay')->toContain('staff.set_salary')->toContain('student.read')
        ->not->toContain('session.mark_attendance')->not->toContain('student.update')
        ->not->toContain('payment_settings.manage');

    // Customer service: the front desk, never money.
    expect(array_intersect($map['CUSTOMER_SERVICE'], PermissionCatalog::FINANCIAL))->toBe([])
        ->and($map['CUSTOMER_SERVICE'])->toContain('student.create')->toContain('trial.manage')
        ->not->toContain('session.cancel')->not->toContain('session.mark_attendance');

    // Every shared role is granted in the database too.
    foreach (['MANAGER', 'ACCOUNTANT', 'CUSTOMER_SERVICE'] as $role) {
        expect(PermissionResolver::forRole($role))->toEqualCanonicalizing($map[$role]);
    }
});

// ── Teacher pay ──────────────────────────────────────────────────────────────

it('blanks teacher pay for the front desk and keeps it for the owner, the accountant and the supervisor', function () {
    Sanctum::actingAs($this->owner);
    $row = collect($this->getJson('/api/teachers')->assertOk()->json('rows'))->firstWhere('id', $this->teacher);
    expect($row['session_rate_minor'])->toBe(12000);

    Sanctum::actingAs($this->accountant);
    $this->getJson("/api/teachers/{$this->teacher}")->assertOk()->assertJsonPath('teacher.session_rate_minor', 12000);

    // The supervisor adds teachers with their pay, so they read it too.
    Sanctum::actingAs($this->supervisor);
    $this->getJson("/api/teachers/{$this->teacher}")->assertOk()->assertJsonPath('teacher.session_rate_minor', 12000);

    Sanctum::actingAs($this->frontDesk);
    $row = collect($this->getJson('/api/teachers')->assertOk()->json('rows'))->firstWhere('id', $this->teacher);
    expect($row)->toHaveKey('session_rate_minor')
        ->and($row['session_rate_minor'])->toBeNull()
        ->and($row['fixed_salary_minor'])->toBeNull()
        ->and($row['full_name'])->toBe('Rate Teacher');

    $detail = $this->getJson("/api/teachers/{$this->teacher}")->assertOk();
    expect($detail->json('teacher.session_rate_minor'))->toBeNull()
        ->and($detail->json('student_rates'))->toBe([]);

    // Ranking by a hidden rate would leak it.
    $this->getJson('/api/teachers?sort=rate')->assertStatus(422);
});

it('lets the accountant set a teacher pay without the power to edit the teacher', function () {
    Sanctum::actingAs($this->accountant);

    $this->patchJson("/api/teachers/{$this->teacher}", ['session_rate_minor' => 15000, 'pay_type' => 'HOURLY'])->assertOk();
    $this->patchJson("/api/teachers/{$this->teacher}", ['full_name' => 'Not Yours'])->assertForbidden();

    $this->asAcademy($this->academy);
    expect((int) DB::table('teachers')->where('id', $this->teacher)->value('session_rate_minor'))->toBe(15000);
});

it('lets a supervisor run a teacher and set their pay', function () {
    Sanctum::actingAs($this->supervisor);

    $this->patchJson("/api/teachers/{$this->teacher}", ['full_name' => 'Renamed Teacher'])->assertOk();
    $this->patchJson("/api/teachers/{$this->teacher}", ['session_rate_minor' => 15000, 'pay_type' => 'HOURLY'])->assertOk();
    $this->postJson('/api/teachers', ['full_name' => 'Priced Hire', 'session_rate_minor' => 15000])->assertCreated();

    $this->asAcademy($this->academy);
    expect((int) DB::table('teachers')->where('id', $this->teacher)->value('session_rate_minor'))->toBe(15000)
        ->and((int) DB::table('teachers')->where('full_name', 'Priced Hire')->value('session_rate_minor'))->toBe(15000);
});

it('keeps teacher pay from a role that edits teachers without the right', function () {
    Sanctum::actingAs($this->owner);
    $code = $this->postJson('/api/roles', [
        'name' => 'Teacher desk', 'permissions' => ['teacher.read', 'teacher.create', 'teacher.update'],
    ])->assertCreated()->json('code');
    Sanctum::actingAs($this->makeUser($this->academy, $code, ['email' => 'teacher-desk@test.local']));

    $this->patchJson("/api/teachers/{$this->teacher}", ['full_name' => 'Renamed Teacher'])->assertOk();
    $this->patchJson("/api/teachers/{$this->teacher}", ['session_rate_minor' => 99900])->assertForbidden();
    $this->patchJson("/api/teachers/{$this->teacher}", ['pay_type' => 'FIXED', 'fixed_salary_minor' => 500000])->assertForbidden();

    // Adding a teacher without a pay decision works; the owner sets the pay later.
    $this->postJson('/api/teachers', ['full_name' => 'New Hire', 'pay_type' => 'HOURLY', 'session_rate_minor' => 0])->assertCreated();
    $this->postJson('/api/teachers', ['full_name' => 'Priced Hire', 'session_rate_minor' => 15000])->assertForbidden();

    $this->asAcademy($this->academy);
    expect((int) DB::table('teachers')->where('id', $this->teacher)->value('session_rate_minor'))->toBe(12000);
});

// ── Staff salaries ───────────────────────────────────────────────────────────

it('blanks staff salaries for a supervisor and refuses a salary from a role without the right', function () {
    Sanctum::actingAs($this->owner);
    $staffId = $this->postJson('/api/staff', [
        'full_name' => 'Paid Clerk', 'salary_minor' => 800000, 'currency' => 'EGP',
    ])->assertCreated()->json('staffId');

    $this->getJson("/api/staff/{$staffId}")->assertOk()->assertJsonPath('staff.salary_minor', 800000);

    Sanctum::actingAs($this->supervisor);
    $row = collect($this->getJson('/api/staff')->assertOk()->json('rows'))->firstWhere('id', $staffId);
    expect($row['salary_minor'])->toBeNull()->and($row['full_name'])->toBe('Paid Clerk');
    $this->getJson("/api/staff/{$staffId}")->assertOk()->assertJsonPath('staff.salary_minor', null);

    // An HR role without staff.set_salary adds people, but not their pay.
    Sanctum::actingAs($this->owner);
    $code = $this->postJson('/api/roles', [
        'name' => 'HR desk', 'permissions' => ['staff.read', 'staff.create', 'staff.update'],
    ])->assertCreated()->json('code');
    Sanctum::actingAs($this->makeUser($this->academy, $code, ['email' => 'hr-team@test.local']));

    $this->postJson('/api/staff', ['full_name' => 'Unpaid Clerk'])->assertCreated();
    $this->postJson('/api/staff', ['full_name' => 'Paid Clerk 2', 'salary_minor' => 500000])->assertForbidden();
    $this->patchJson("/api/staff/{$staffId}", ['salary_minor' => 1])->assertForbidden();
    $this->patchJson("/api/staff/{$staffId}", ['notes' => 'met today'])->assertOk();
});

// ── The money half of a cancellation ─────────────────────────────────────────

it('records a supervisor cancellation with the standard verdict, whatever the payload asks', function () {
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->supervisor);
    $res = $this->postJson("/api/sessions/{$session}/attendance", [
        'status' => 'CANCELLED_BY_STUDENT', 'charge_student' => true, 'pay_teacher' => true,
    ])->assertOk();

    expect($res->json('classification'))->toBe(['billableToStudent' => false, 'countsForTeacher' => false]);
    $this->asAcademy($this->academy);
    expect(DB::table('invoice_line_items')->where('session_id', $session)->count())->toBe(0);
});

it('still lets the owner charge a late cancellation', function () {
    $session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'SCHEDULED',
    ]);

    Sanctum::actingAs($this->owner);
    $res = $this->postJson("/api/sessions/{$session}/attendance", [
        'status' => 'CANCELLED_BY_STUDENT', 'charge_student' => true, 'pay_teacher' => false,
    ])->assertOk();

    expect($res->json('classification'))->toBe(['billableToStudent' => true, 'countsForTeacher' => false]);
});

// ── Statistics, quality money, settings, package alerts ─────────────────────

it('keeps the statistics pages from a supervisor', function () {
    Sanctum::actingAs($this->supervisor);
    $this->getJson('/api/supervision/stats?from=2026-06-01&to=2026-06-07')->assertForbidden();
    $this->getJson('/api/teacher-insights?from=2026-06-01&to=2026-06-07')->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/supervision/stats?from=2026-06-01&to=2026-06-07')->assertOk();
    $this->getJson('/api/teacher-insights?from=2026-06-01&to=2026-06-07')->assertOk();
});

it('shows a supervisor the quality judgement but not what it docked', function () {
    Sanctum::actingAs($this->supervisor);

    $this->getJson('/api/quality/reports/summary?year=2026&month=6')->assertOk()->assertJsonPath('docked', []);
    $this->putJson('/api/quality/settings', [
        'auto_deduct_enabled' => true, 'auto_deduct_grace_hours' => 6, 'auto_deduct_basis' => 'FIXED',
        'auto_deduct_amount_minor' => 5000, 'auto_deduct_percent' => 0,
    ])->assertForbidden();
});

it('keeps package billing alerts out of an inbox that cannot read packages', function () {
    $this->asAcademy($this->academy);
    foreach (['PACKAGES', 'REPORTS'] as $category) {
        DB::table('notifications')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academy,
            'audience_role' => 'ACADEMY_OWNER',
            'type' => $category === 'PACKAGES' ? 'PACKAGE_LOW' : 'REPORT_OVERDUE',
            'category' => $category,
            'data' => json_encode([]),
            'created_at' => now(),
        ]);
    }
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    expect(collect($this->getJson('/api/notifications')->assertOk()->json('notifications'))->pluck('category')->all())
        ->toContain('PACKAGES');

    // The supervisor runs packages now, so their alerts are theirs too.
    Sanctum::actingAs($this->supervisor);
    expect(collect($this->getJson('/api/notifications')->assertOk()->json('notifications'))->pluck('category')->all())
        ->toContain('PACKAGES');

    Sanctum::actingAs($this->owner);
    $code = $this->postJson('/api/roles', [
        'name' => 'Inbox only', 'permissions' => ['notification.read', 'session.read'],
    ])->assertCreated()->json('code');
    Sanctum::actingAs($this->makeUser($this->academy, $code, ['email' => 'inbox-team@test.local']));
    $res = $this->getJson('/api/notifications')->assertOk();
    expect(collect($res->json('notifications'))->pluck('category')->all())->not->toContain('PACKAGES');
    $this->getJson('/api/notifications/summary')->assertOk()->assertJsonPath('packages', 0);
});

// ── Handing the roles out ────────────────────────────────────────────────────

it('lets the owner hand out every shared role from the team page', function () {
    Sanctum::actingAs($this->owner);

    foreach (PermissionCatalog::STAFF_ROLES as $i => $role) {
        $userId = $this->postJson('/api/staff', [
            'full_name' => "Member {$role}",
            'create_login' => true,
            'email' => "member{$i}@test.local",
            'password' => 'secret-password-1',
            'role' => $role,
        ])->assertCreated()->json('userId');

        $this->asAcademy($this->academy);
        expect(DB::table('user_roles')->where('user_id', $userId)->value('role'))->toBe($role);
        $this->clearTenantContext();
    }
});

it('serves the builder its sections, presets and markings', function () {
    Sanctum::actingAs($this->owner);
    $res = $this->getJson('/api/roles')->assertOk();

    expect(collect($res->json('system'))->pluck('code')->all())
        ->toContain('MANAGER')->toContain('ACCOUNTANT')->toContain('CUSTOMER_SERVICE');
    expect(collect($res->json('presets'))->pluck('key')->all())
        ->toEqualCanonicalizing(['manager', 'supervisor', 'accountant', 'customer_service']);

    $areas = collect($res->json('areas'))->keyBy('key');
    expect($areas['students']['view'])->toBe(['student.read'])
        ->and($areas['teacher_pay']['kind'])->toBe('financial')
        ->and($areas['statistics']['kind'])->toBe('statistics');
    // No video module on this academy → no classroom section to offer.
    expect($areas->has('classroom'))->toBeFalse();

    expect($res->json('financial'))->toContain('teacher.set_pay')->toContain('session.bill_override');
    expect($res->json('statistics'))->toContain('supervision.stats');
});

// ── The migration's grandfathering ───────────────────────────────────────────

it('grandfathers custom roles by what their owner meant, not by the leak', function () {
    Sanctum::actingAs($this->owner);
    $money = $this->postJson('/api/roles', [
        'name' => 'Money desk', 'permissions' => ['payout.read', 'teacher.read', 'session.cancel'],
    ])->assertCreated()->json('roleId');
    $floor = $this->postJson('/api/roles', [
        'name' => 'Floor lead', 'permissions' => ['teacher.read', 'teacher.update', 'session.cancel', 'specialization.manage', 'teacher_quality.read'],
    ])->assertCreated()->json('roleId');

    DB::transaction(function () {
        (require database_path('migrations/2026_10_19_200002_team_roles_and_money_split.php'))->up();
    });
    $this->clearTenantContext();

    $codes = function (string $roleId): array {
        $this->asAcademy($this->academy);

        return DB::table('academy_role_permissions as arp')
            ->join('permissions as p', 'p.id', '=', 'arp.permission_id')
            ->where('arp.role_id', $roleId)
            ->pluck('p.code')->all();
    };

    // Already read the payroll → sees what teachers and staff earn; cancels → keeps charging.
    expect($codes($money))->toContain('teacher.set_pay')->toContain('staff.set_salary')->toContain('session.bill_override');

    // Never had a money capability → the rates it saw were a leak, not a grant.
    expect($codes($floor))->not->toContain('teacher.set_pay')->not->toContain('staff.set_salary')
        // …but what it already did keeps working.
        ->toContain('session.bill_override')->toContain('settings.manage')->toContain('teacher_quality.insights');

    // And the built-in supervisor stays without the statistics page.
    expect(PermissionResolver::forRole('SUPERVISOR'))->not->toContain('supervision.stats');
});
