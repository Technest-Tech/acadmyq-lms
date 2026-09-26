<?php

declare(strict_types=1);

use App\Jobs\OpenFixedSalaryPayoutsJob;
use App\Services\Payroll;
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

/*
|--------------------------------------------------------------------------
| Teacher pay types — HOURLY, PER_STUDENT, FIXED
|--------------------------------------------------------------------------
|
| A teacher is paid one of three ways, and the month's statement is worked out from it:
|   • PER_STUDENT — every lesson at its own student's hourly rate, the teacher's rate as fallback;
|   • FIXED       — a monthly salary on the statement (`base_minor`), lessons at 0;
|   • HOURLY      — the one rate for everybody, as before.
| Pay is still snapshotted when a lesson is marked; re-pricing an open month is explicit.
*/

beforeEach(function () {
    Carbon::setTestNow('2026-06-30 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);

    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-paytypes@test.local']);

    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->yusuf = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Yusuf']);
    $this->maryam = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Maryam']);

    $this->asAcademy($this->academy);
    foreach ([$this->yusuf, $this->maryam] as $student) {
        DB::table('subscriptions')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $this->academy,
            'student_id' => $student,
            'plan_label' => '1:1 EGP',
            'price_minor' => 10000,
            'currency' => 'EGP',
            'price_basis' => 'PER_SESSION',
            'sessions_per_month' => null,
            'status' => 'ACTIVE',
            'start_date' => '2026-01-01',
        ]);
    }

    /** An ATTENDED lesson, driven through the real attendance path. */
    $this->lesson = function (string $teacher, string $student, string $at = '2026-06-15 10:00:00+00', int $minutes = 60): string {
        $id = $this->createSession($this->academy, $student, $teacher, [
            'scheduled_at_utc' => $at,
            'duration_minutes' => $minutes,
            'status' => 'SCHEDULED',
        ]);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$id}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $id;
    };

    $this->payoutOf = function (string $teacher, int $month = 6): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')
            ->where('teacher_id', $teacher)
            ->where('period_year', 2026)
            ->where('period_month', $month)
            ->first();
    };

    $this->lineFor = function (string $session): int {
        $this->asAcademy($this->academy);

        return (int) DB::table('payout_line_items')->where('session_id', $session)->value('amount_minor');
    };
});

afterEach(fn () => Carbon::setTestNow());

it('pays each lesson at its own student\'s rate, and the default for anyone without one', function () {
    $teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 5000, 'pay_type' => 'PER_STUDENT']);
    DB::table('teacher_student_rates')->insert([
        'academy_id' => $this->academy,
        'teacher_id' => $teacher,
        'student_id' => $this->yusuf,
        'rate_minor' => 8000,
    ]);

    $withYusuf = ($this->lesson)($teacher, $this->yusuf, '2026-06-10 10:00:00+00', 60);
    $withMaryam = ($this->lesson)($teacher, $this->maryam, '2026-06-11 10:00:00+00', 30);

    expect(($this->lineFor)($withYusuf))->toBe(8000)        // Yusuf's own rate, one hour
        ->and(($this->lineFor)($withMaryam))->toBe(2500);    // the default, pro-rated to 30 min

    expect((int) ($this->payoutOf)($teacher)->total_minor)->toBe(10500);
});

it('ignores per-student rates left on file once the teacher is back on one hourly rate', function () {
    $teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 5000, 'pay_type' => 'HOURLY']);
    DB::table('teacher_student_rates')->insert([
        'academy_id' => $this->academy,
        'teacher_id' => $teacher,
        'student_id' => $this->yusuf,
        'rate_minor' => 8000,
    ]);

    $session = ($this->lesson)($teacher, $this->yusuf);

    expect(($this->lineFor)($session))->toBe(5000);
});

it('puts a fixed salary on the statement and pays its lessons nothing extra', function () {
    $teacher = $this->createTeacher($this->academy, [
        'session_rate_minor' => 5000,
        'pay_type' => 'FIXED',
        'fixed_salary_minor' => 600000,
    ]);

    $session = ($this->lesson)($teacher, $this->yusuf);

    expect(($this->lineFor)($session))->toBe(0);
    $payout = ($this->payoutOf)($teacher);
    expect((int) $payout->base_minor)->toBe(600000)
        ->and((int) $payout->total_minor)->toBe(600000);

    // Finalize's integrity sum now includes the salary: base + lines + rewards − deductions.
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/payouts/finalize', ['year' => 2026, 'month' => 6])
        ->assertOk()
        ->assertJsonPath('finalized', 1);

    $this->getJson("/api/payouts/{$payout->id}")
        ->assertOk()
        ->assertJsonPath('payout.base_minor', 600000)
        ->assertJsonPath('payout.sessions_minor', 0)
        ->assertJsonPath('payout.total_minor', 600000)
        ->assertJsonPath('payout.pay_type', 'FIXED');
});

it('opens this month\'s statement the moment a salaried teacher is created', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/teachers', [
        'full_name' => 'Ustadha Huda',
        'pay_type' => 'FIXED',
        'fixed_salary_minor' => 450000,
        'currency' => 'EGP',
    ])->assertCreated()->json('teacherId');

    $payout = ($this->payoutOf)($id);
    expect($payout)->not->toBeNull()
        ->and((int) $payout->base_minor)->toBe(450000)
        ->and((int) $payout->total_minor)->toBe(450000);

    $this->asAcademy($this->academy);
    expect((int) DB::table('teachers')->where('id', $id)->value('session_rate_minor'))->toBe(0);
});

it('requires the salary for a fixed teacher and the rate for everyone else', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/teachers', ['full_name' => 'A', 'pay_type' => 'FIXED'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('fixed_salary_minor');

    $this->postJson('/api/teachers', ['full_name' => 'B', 'pay_type' => 'PER_STUDENT'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('session_rate_minor');

    $this->postJson('/api/teachers', ['full_name' => 'C', 'session_rate_minor' => 100, 'pay_type' => 'MONTHLY'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('pay_type');
});

it('saves per-student rates on create and returns them on read', function () {
    Sanctum::actingAs($this->owner);

    $id = $this->postJson('/api/teachers', [
        'full_name' => 'Ustadh Kareem',
        'pay_type' => 'PER_STUDENT',
        'session_rate_minor' => 5000,
        'student_rates' => [['student_id' => $this->yusuf, 'rate_minor' => 9000]],
    ])->assertCreated()->json('teacherId');

    $this->getJson("/api/teachers/{$id}")
        ->assertOk()
        ->assertJsonPath('teacher.pay_type', 'PER_STUDENT')
        ->assertJsonPath('student_rates.0.student_id', $this->yusuf)
        ->assertJsonPath('student_rates.0.rate_minor', 9000)
        // Not assigned to this teacher (yet) — the rate still stands for any lesson they teach.
        ->assertJsonPath('student_rates.0.is_current', false);
});

it('replaces the whole set of per-student rates on update, and refuses an unknown student', function () {
    $teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 5000, 'pay_type' => 'PER_STUDENT']);
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/teachers/{$teacher}", [
        'student_rates' => [
            ['student_id' => $this->yusuf, 'rate_minor' => 9000],
            ['student_id' => $this->maryam, 'rate_minor' => 7000],
        ],
    ])->assertOk()->assertJsonPath('changed', ['student_rates']);

    // Maryam left out → back on the default.
    $this->patchJson("/api/teachers/{$teacher}", [
        'student_rates' => [['student_id' => $this->yusuf, 'rate_minor' => 9500]],
    ])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('teacher_student_rates')->where('teacher_id', $teacher)->pluck('rate_minor', 'student_id')->map(fn ($v) => (int) $v)->all())
        ->toBe([$this->yusuf => 9500]);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$teacher}", [
        'student_rates' => [['student_id' => (string) Str::uuid(), 'rate_minor' => 1]],
    ])->assertUnprocessable()->assertJsonValidationErrors('student_rates');
});

it('moves this month\'s statement by the difference when a teacher goes onto, within, or off a salary', function () {
    $teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 5000]);
    ($this->lesson)($teacher, $this->yusuf);   // 5000 of lessons already on June's statement

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$teacher}", ['pay_type' => 'FIXED', 'fixed_salary_minor' => 300000])->assertOk();
    $p = ($this->payoutOf)($teacher);
    expect((int) $p->base_minor)->toBe(300000)->and((int) $p->total_minor)->toBe(305000);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$teacher}", ['fixed_salary_minor' => 350000])->assertOk();
    $p = ($this->payoutOf)($teacher);
    expect((int) $p->base_minor)->toBe(350000)->and((int) $p->total_minor)->toBe(355000);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$teacher}", ['pay_type' => 'HOURLY'])->assertOk();
    $p = ($this->payoutOf)($teacher);
    expect((int) $p->base_minor)->toBe(0)->and((int) $p->total_minor)->toBe(5000);
});

it('re-prices an open month at the teacher\'s current rates only when asked', function () {
    $teacher = $this->createTeacher($this->academy, ['session_rate_minor' => 5000]);
    $session = ($this->lesson)($teacher, $this->yusuf);
    $payoutId = (string) ($this->payoutOf)($teacher)->id;

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/teachers/{$teacher}", [
        'pay_type' => 'PER_STUDENT',
        'student_rates' => [['student_id' => $this->yusuf, 'rate_minor' => 8000]],
    ])->assertOk();

    // Editing pay never rewrites a lesson already paid (AC-4.5)…
    expect(($this->lineFor)($session))->toBe(5000);

    // …until the owner applies it to the month.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payoutId}/reprice")
        ->assertOk()
        ->assertJsonPath('delta_minor', 3000);

    expect(($this->lineFor)($session))->toBe(8000)
        ->and((int) ($this->payoutOf)($teacher)->total_minor)->toBe(8000);

    // Idempotent: nothing left to move.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/payouts/{$payoutId}/reprice")->assertOk()->assertJsonPath('delta_minor', 0);

    // And the statement still passes finalize's integrity check afterwards.
    $this->postJson('/api/payouts/finalize', ['year' => 2026, 'month' => 6])->assertOk();

    $this->postJson("/api/payouts/{$payoutId}/reprice")->assertUnprocessable();
});

it('reports fixed salaries in the salary window, anchored on the month they are for', function () {
    $fixed = $this->createTeacher($this->academy, ['pay_type' => 'FIXED', 'fixed_salary_minor' => 400000]);
    app(Payroll::class)->syncFixedSalary($fixed);

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/payouts/range?from=2026-06-01&to=2026-06-30')
        ->assertOk()
        ->assertJsonPath('teachers.0.teacher_id', $fixed)
        ->assertJsonPath('teachers.0.base_minor', 400000)
        ->assertJsonPath('teachers.0.net_minor', 400000)
        ->assertJsonPath('currencies.0.base_minor', 400000);

    // A window that starts after the 1st does not carry a slice of the month's salary.
    $this->getJson('/api/payouts/range?from=2026-06-10&to=2026-06-30')
        ->assertOk()
        ->assertJsonCount(0, 'teachers');
});

it('opens statements daily for active salaried teachers only, once', function () {
    $fixed = $this->createTeacher($this->academy, ['pay_type' => 'FIXED', 'fixed_salary_minor' => 400000]);
    $hourly = $this->createTeacher($this->academy, ['pay_type' => 'HOURLY']);
    $gone = $this->createTeacher($this->academy, [
        'pay_type' => 'FIXED',
        'fixed_salary_minor' => 400000,
        'is_active' => false,
        'deleted_at' => now(),
    ]);
    $this->clearTenantContext();

    expect((new OpenFixedSalaryPayoutsJob($this->academy))->handle(app(Payroll::class)))
        ->toBe([$this->academy => 1]);
    // Idempotent — tomorrow's run finds the statement already there.
    expect((new OpenFixedSalaryPayoutsJob($this->academy))->handle(app(Payroll::class)))
        ->toBe([$this->academy => 0]);

    expect((int) ($this->payoutOf)($fixed)->base_minor)->toBe(400000)
        ->and(($this->payoutOf)($hourly))->toBeNull()
        ->and(($this->payoutOf)($gone))->toBeNull();
});
