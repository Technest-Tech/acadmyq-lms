<?php

declare(strict_types=1);

use App\Services\Invoicing;
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

/**
 * Correcting the lessons behind a salary from the payroll page. An open month moves in place, like
 * the attendance page. A sealed month is the case this exists for: wrong lessons are found when the
 * salary is checked, after the 3rd, so the paid statement and closed bill stay and the difference
 * lands on the teacher's open statement.
 */
beforeEach(function () {
    Carbon::setTestNow('2026-06-20 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone' => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id' => $proPlan,
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-fix@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-fix@test.local']);
    // 5000 per hour, so a 60-minute lesson pays exactly 5000.
    $this->teacher = $this->createTeacher($this->academy, ['user_id' => $this->teacherUser->id, 'session_rate_minor' => 5000, 'currency' => 'EGP']);
    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student = $this->createStudent($this->academy, $this->guardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academy,
        'student_id' => $this->student,
        'plan_label' => 'Test',
        'price_minor' => 8000,
        'currency' => 'EGP',
        'price_basis' => 'PER_SESSION',
        'status' => 'ACTIVE',
        'start_date' => '2026-01-01',
    ]);

    $this->lesson = fn (string $at): string => $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => $at, 'duration_minutes' => 60, 'status' => 'SCHEDULED',
    ]);
    $this->attended = function (string $at): string {
        $id = ($this->lesson)($at);
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/sessions/{$id}/attendance", ['status' => 'ATTENDED'])->assertOk();

        return $id;
    };
    $this->closeJune = function (): void {
        $this->asAcademy($this->academy);
        app(Invoicing::class)->closePeriodInvoices($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
        app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
        Carbon::setTestNow('2026-07-05 12:00:00');
        Sanctum::actingAs($this->owner);
    };
    $this->payout = function (int $month): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')->where('teacher_id', $this->teacher)->where('period_year', 2026)->where('period_month', $month)->first();
    };
    $this->row = function (string $id): object {
        $this->asAcademy($this->academy);

        return DB::table('sessions')->where('id', $id)->first();
    };
    $this->invoiceLine = function (string $id): ?object {
        $this->asAcademy($this->academy);

        return DB::table('invoice_line_items')->where('session_id', $id)->first();
    };
});

afterEach(fn () => Carbon::setTestNow());

it('removes a lesson from an open month, on the salary and the bill', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $wrong = ($this->attended)('2026-06-12 10:00:00+00');

    $this->getJson("/api/payouts/lessons/{$wrong}/removal-preview")
        ->assertOk()
        ->assertJsonPath('amount_minor', 5000)
        ->assertJsonPath('payout_sealed', false)
        ->assertJsonPath('student_locked', false);

    $this->deleteJson("/api/payouts/lessons/{$wrong}")->assertOk();

    expect((int) ($this->payout)(6)->total_minor)->toBe(5000)
        ->and(($this->invoiceLine)($wrong))->toBeNull()
        ->and(($this->row)($wrong)->hidden_at)->not->toBeNull()
        ->and(($this->row)($wrong)->status)->toBe('CANCELLED_BY_TEACHER');
});

it('removes a lesson from a sealed month by carrying a deduction, never touching what was paid', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $wrong = ($this->attended)('2026-06-12 10:00:00+00');
    $invoiceLineBefore = ($this->invoiceLine)($wrong);
    ($this->closeJune)();

    $this->getJson("/api/payouts/lessons/{$wrong}/removal-preview")
        ->assertJsonPath('payout_sealed', true)
        ->assertJsonPath('student_locked', true);

    $this->deleteJson("/api/payouts/lessons/{$wrong}")->assertOk();

    $june = ($this->payout)(6);
    $july = ($this->payout)(7);
    expect((int) $june->total_minor)->toBe(10000)
        ->and($july->finalized_at)->toBeNull()
        ->and((int) $july->deductions_minor)->toBe(5000)
        ->and((int) $july->total_minor)->toBe(-5000);

    $this->asAcademy($this->academy);
    $adjustment = DB::table('payout_adjustments')->where('payout_id', $july->id)->first();
    expect($adjustment->repriced_payout_id)->toBe($june->id)
        ->and($adjustment->source)->toBe('MANUAL');

    // The family's closed bill stands, as a cancellation that still charges.
    $row = ($this->row)($wrong);
    expect(($this->invoiceLine)($wrong)->amount_minor)->toBe($invoiceLineBefore->amount_minor)
        ->and((bool) $row->billed)->toBeTrue()
        ->and((bool) $row->bill_override)->toBeTrue()
        ->and((bool) $row->paid_to_teacher)->toBeFalse()
        ->and($row->hidden_at)->not->toBeNull();

    // The row is flagged on the window it was paid in, and can't be removed twice.
    $lines = $this->getJson("/api/payouts/range/lessons?teacher_id={$this->teacher}&from=2026-06-01&to=2026-06-30")->assertOk()->json('lessons');
    expect(collect($lines)->firstWhere('session_id', $wrong)['removed'])->toBeTrue();
    $this->deleteJson("/api/payouts/lessons/{$wrong}")->assertUnprocessable();
});

it('does not owe a sealed correction twice when the month is recalculated', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    $removed = ($this->attended)('2026-06-12 10:00:00+00');
    $shortened = ($this->attended)('2026-06-14 10:00:00+00');
    ($this->closeJune)();

    $this->deleteJson("/api/payouts/lessons/{$removed}")->assertOk();
    $this->patchJson("/api/payouts/lessons/{$shortened}/duration", ['duration_minutes' => 30])->assertOk();

    expect((int) ($this->payout)(7)->deductions_minor)->toBe(7500);

    $sealed = collect($this->getJson("/api/payouts/recalc-preview?teacher_id={$this->teacher}")->assertOk()->json('statements'))
        ->firstWhere('id', ($this->payout)(6)->id);
    expect($sealed['delta_minor'])->toBe(0);
});

it('corrects a length on a sealed month: difference carried, closed bill left, lesson updated', function () {
    $lesson = ($this->attended)('2026-06-10 10:00:00+00');
    ($this->closeJune)();

    $this->getJson("/api/payouts/lessons/{$lesson}/duration-preview?duration_minutes=90")
        ->assertOk()
        ->assertJsonPath('can_change', true)
        ->assertJsonPath('payout.finalized', true)
        ->assertJsonPath('payout.amount_after', 7500)
        ->assertJsonPath('invoice.status', 'CLOSED');

    $this->patchJson("/api/payouts/lessons/{$lesson}/duration", ['duration_minutes' => 90])->assertOk();

    expect((int) ($this->payout)(6)->total_minor)->toBe(5000)
        ->and((int) ($this->payout)(7)->rewards_minor)->toBe(2500)
        ->and((int) ($this->row)($lesson)->duration_minutes)->toBe(90)
        ->and((int) ($this->invoiceLine)($lesson)->amount_minor)->toBe(8000);
});

it('corrects a length on an open month in place', function () {
    $lesson = ($this->attended)('2026-06-10 10:00:00+00');

    $this->patchJson("/api/payouts/lessons/{$lesson}/duration", ['duration_minutes' => 30])->assertOk();

    expect((int) ($this->payout)(6)->total_minor)->toBe(2500)
        ->and((int) ($this->payout)(6)->deductions_minor)->toBe(0);
});

it('adds a missing lesson to its month, on the salary and the bill', function () {
    Sanctum::actingAs($this->owner);

    // 13:00 in Cairo (UTC+3 in June) is 10:00 UTC.
    $this->postJson('/api/payouts/lessons', [
        'teacher_id' => $this->teacher,
        'student_id' => $this->student,
        'local_datetime' => '2026-06-15T13:00',
        'duration_minutes' => 60,
    ])->assertCreated()
        ->assertJsonPath('statement_month', 6)
        ->assertJsonPath('carried', false);

    $this->asAcademy($this->academy);
    $session = DB::table('sessions')->where('teacher_id', $this->teacher)->first();
    expect($session->status)->toBe('ATTENDED')
        ->and(Carbon::parse($session->scheduled_at_utc)->utc()->format('Y-m-d H:i'))->toBe('2026-06-15 10:00')
        ->and((int) ($this->payout)(6)->total_minor)->toBe(5000)
        ->and(($this->invoiceLine)($session->id))->not->toBeNull();
});

it('adds a lesson to a sealed month on the next open statement', function () {
    ($this->attended)('2026-06-10 10:00:00+00');
    ($this->closeJune)();

    $this->postJson('/api/payouts/lessons', [
        'teacher_id' => $this->teacher,
        'student_id' => $this->student,
        'local_datetime' => '2026-06-15T13:00',
        'duration_minutes' => 60,
    ])->assertCreated()
        ->assertJsonPath('statement_month', 7)
        ->assertJsonPath('carried', true);

    expect((int) ($this->payout)(6)->total_minor)->toBe(5000)
        ->and((int) ($this->payout)(7)->total_minor)->toBe(5000);
});

it('counts the existing slot instead of duplicating it, and refuses one already paid', function () {
    $existing = ($this->lesson)('2026-06-15 10:00:00+00');
    Sanctum::actingAs($this->owner);
    $body = [
        'teacher_id' => $this->teacher,
        'student_id' => $this->student,
        'local_datetime' => '2026-06-15T13:00',
        'duration_minutes' => 45,
    ];

    $this->postJson('/api/payouts/lessons', $body)->assertCreated()->assertJsonPath('session_id', $existing);

    expect((int) ($this->row)($existing)->duration_minutes)->toBe(45)
        ->and(DB::table('sessions')->where('teacher_id', $this->teacher)->count())->toBe(1);

    $this->postJson('/api/payouts/lessons', $body)->assertUnprocessable();
});

it('refuses a lesson that has not happened yet', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/payouts/lessons', [
        'teacher_id' => $this->teacher,
        'student_id' => $this->student,
        'local_datetime' => '2026-06-25T13:00',
        'duration_minutes' => 60,
    ])->assertUnprocessable();
});

it('lists past lessons that pay nothing, and counts one on request', function () {
    $unmarked = ($this->lesson)('2026-06-10 10:00:00+00');
    ($this->lesson)('2026-06-25 10:00:00+00'); // still ahead
    ($this->attended)('2026-06-11 10:00:00+00');

    $rows = $this->getJson("/api/payouts/range/lessons?teacher_id={$this->teacher}&from=2026-06-01&to=2026-06-30&currency=EGP")
        ->assertOk()
        ->json('not_on_salary');
    expect($rows)->toHaveCount(1)
        ->and($rows[0]['id'])->toBe($unmarked)
        ->and($rows[0]['session_date'])->toBe('2026-06-10')
        ->and($rows[0]['local_time'])->toBe('13:00');

    $this->postJson("/api/payouts/lessons/{$unmarked}/attend")->assertOk()->assertJsonPath('statement_month', 6);

    expect(($this->row)($unmarked)->status)->toBe('ATTENDED')
        ->and((int) ($this->payout)(6)->total_minor)->toBe(10000);
});

it('is the owner\'s money right: a teacher cannot touch it', function () {
    $lesson = ($this->attended)('2026-06-10 10:00:00+00');
    Sanctum::actingAs($this->teacherUser);

    $this->deleteJson("/api/payouts/lessons/{$lesson}")->assertForbidden();
    $this->patchJson("/api/payouts/lessons/{$lesson}/duration", ['duration_minutes' => 30])->assertForbidden();
    $this->postJson('/api/payouts/lessons', [
        'teacher_id' => $this->teacher,
        'student_id' => $this->student,
        'local_datetime' => '2026-06-15T13:00',
        'duration_minutes' => 60,
    ])->assertForbidden();
});
