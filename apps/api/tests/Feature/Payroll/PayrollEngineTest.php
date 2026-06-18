<?php

declare(strict_types=1);

use App\Domain\SessionClassifier;
use App\Enums\SessionStatus;
use App\Services\Payroll;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

// ─── Shared setup ────────────────────────────────────────────────────────────
//
// Mirrors the Sprint 7 invoicing test setup: a single academy (EGP, Africa/Cairo,
// PER_GUARDIAN), an owner login, a teacher (hourly rate 5000 = 50 EGP/hr) linked to a teacher login,
// and a guardian+student with a PER_SESSION subscription at 10 000 (100 EGP). Sessions are
// created SCHEDULED in June 2026 and driven through the attendance API so the real Sprint-6
// → Sprint-8 transaction fires.

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // PRO plan grants the `invoicing` + `payroll` entitlements the API routes gate on (Sprint 9).
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: [
        'default_currency' => 'EGP',
        'timezone'         => 'Africa/Cairo',
        'invoice_grouping' => 'PER_GUARDIAN',
        'plan_id'          => $proPlan,
    ]);

    $this->owner       = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-pay@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-pay@test.local']);
    $this->teacher     = $this->createTeacher($this->academy, [
        'user_id'            => $this->teacherUser->id,
        'session_rate_minor' => 5000,
        'currency'           => 'EGP',
    ]);

    $this->guardian = $this->createGuardian($this->academy, ['currency' => 'EGP']);
    $this->student  = $this->createStudent($this->academy, $this->guardian);

    // PER_SESSION subscription at 10 000 piastres so an ATTENDED session bills the student too.
    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id'                 => (string) Str::uuid(),
        'academy_id'         => $this->academy,
        'student_id'         => $this->student,
        'plan_label'         => '1:1 EGP',
        'price_minor'        => 10000,
        'currency'           => 'EGP',
        'price_basis'        => 'PER_SESSION',
        'sessions_per_month' => null,
        'status'             => 'ACTIVE',
        'start_date'         => '2026-01-01',
    ]);

    // Helper: create a SCHEDULED June 2026 session for the academy's teacher/student.
    // 60-minute sessions so an hourly rate pays exactly the full rate (5000/hr × 1h = 5000).
    $this->juneSession = function (array $overrides = []): string {
        return $this->createSession($this->academy, $this->student, $this->teacher, array_merge([
            'scheduled_at_utc' => '2026-06-01 10:00:00+00',
            'duration_minutes' => 60,
            'status'           => 'SCHEDULED',
        ], $overrides));
    };

    // Helper: drive a session outcome through the attendance API as the owner.
    $this->attend = function (string $sessionId, string $status = 'ATTENDED', array $extra = []) {
        Sanctum::actingAs($this->owner);

        return $this->postJson("/api/sessions/{$sessionId}/attendance", ['status' => $status] + $extra);
    };

    // Helper: the open/finalized payout row for a teacher in a period.
    $this->payoutFor = function (?string $teacherId = null, int $year = 2026, int $month = 6): ?object {
        $this->asAcademy($this->academy);

        return DB::table('payouts')
            ->where('academy_id', $this->academy)
            ->where('teacher_id', $teacherId ?? $this->teacher)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->first();
    };

    // Helper: payout line items for a session.
    $this->linesForSession = function (string $sessionId) {
        $this->asAcademy($this->academy);

        return DB::table('payout_line_items')->where('session_id', $sessionId)->get();
    };
});

afterEach(fn () => Carbon::setTestNow());

// ─── Accrual & snapshot ──────────────────────────────────────────────────────

it('TC-8.1: ATTENDED → one payout line; amount = teacher rate; currency matches; paid_to_teacher=true', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();

    $payout = ($this->payoutFor)();
    expect($payout)->not->toBeNull()
        ->and($payout->finalized_at)->toBeNull()
        ->and($payout->currency)->toBe('EGP')
        ->and((int) $payout->total_minor)->toBe(5000);

    $lines = ($this->linesForSession)($session);
    expect($lines)->toHaveCount(1)
        ->and((int) $lines->first()->amount_minor)->toBe(5000)
        ->and($lines->first()->currency)->toBe('EGP');

    $this->asAcademy($this->academy);
    expect((bool) DB::table('sessions')->where('id', $session)->value('paid_to_teacher'))->toBeTrue();
});

it('TC-8.2: two ATTENDED sessions same teacher/period → two lines on one payout; total = 2 × rate', function () {
    $s1 = ($this->juneSession)();
    $s2 = ($this->juneSession)(['scheduled_at_utc' => '2026-06-02 10:00:00+00']);
    ($this->attend)($s1)->assertOk();
    ($this->attend)($s2)->assertOk();

    $payout = ($this->payoutFor)();
    expect((int) $payout->total_minor)->toBe(10000);

    $this->asAcademy($this->academy);
    $lines = DB::table('payout_line_items')->where('payout_id', $payout->id)->get();
    expect($lines)->toHaveCount(2);
});

it('TC-8.3: changing the teacher rate later does not alter an existing line; a new session uses the new rate', function () {
    $s1 = ($this->juneSession)();
    ($this->attend)($s1)->assertOk();

    // Raise the teacher rate after the first line exists.
    $this->asAcademy($this->academy);
    DB::table('teachers')->where('id', $this->teacher)->update(['session_rate_minor' => 8000]);

    $s2 = ($this->juneSession)(['scheduled_at_utc' => '2026-06-03 10:00:00+00']);
    ($this->attend)($s2)->assertOk();

    expect((int) ($this->linesForSession)($s1)->first()->amount_minor)->toBe(5000)  // unchanged snapshot
        ->and((int) ($this->linesForSession)($s2)->first()->amount_minor)->toBe(8000); // new rate

    expect((int) ($this->payoutFor)()->total_minor)->toBe(13000);
});

it('TC-8.4: re-marking the same session ATTENDED does not create a duplicate line', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();
    // Re-post the same outcome — the paid_to_teacher guard short-circuits the hook.
    ($this->attend)($session)->assertOk();

    expect(($this->linesForSession)($session))->toHaveCount(1);
    expect((int) ($this->payoutFor)()->total_minor)->toBe(5000);
});

// ─── Classification consistency (the core rule) ───────────────────────────────

it('TC-8.5: a charged cancellation (charge_student) bills the student but pays the teacher nothing', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session, 'CANCELLED_BY_STUDENT', ['charge_student' => true, 'pay_teacher' => false])->assertOk();

    // Sprint 7: student IS billed.
    $this->asAcademy($this->academy);
    expect(DB::table('invoice_line_items')->where('session_id', $session)->count())->toBe(1);

    // Sprint 8: teacher paid NOTHING — no payout line, no payout row.
    expect(($this->linesForSession)($session))->toHaveCount(0)
        ->and(($this->payoutFor)())->toBeNull();
    expect((bool) DB::table('sessions')->where('id', $session)->value('paid_to_teacher'))->toBeFalse();
});

it('TC-8.6: plain CANCELLED_BY_TEACHER / CANCELLED_BY_STUDENT → no payout line for either', function () {
    foreach (['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT'] as $i => $status) {
        $session = ($this->juneSession)(['scheduled_at_utc' => sprintf('2026-06-0%d 10:00:00+00', $i + 2)]);
        ($this->attend)($session, $status)->assertOk();
        expect(($this->linesForSession)($session))->toHaveCount(0);
    }

    expect(($this->payoutFor)())->toBeNull();
});

it('TC-8.6b: a cancellation with pay_teacher=true accrues the payout', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session, 'CANCELLED_BY_TEACHER', ['pay_teacher' => true])->assertOk();

    expect(($this->linesForSession)($session))->toHaveCount(1)
        ->and((int) ($this->payoutFor)()->total_minor)->toBe(5000);
    expect((bool) DB::table('sessions')->where('id', $session)->value('paid_to_teacher'))->toBeTrue();
});

it('TC-8.7: property — only ATTENDED counts for the teacher, and the engine honors exactly that', function () {
    // Every enum value: classify().countsForTeacher is true iff ATTENDED.
    foreach (SessionStatus::cases() as $status) {
        $expected = $status === SessionStatus::Attended;
        expect(SessionClassifier::countsForTeacher($status))->toBe($expected);
    }

    // The engine honors it for every human-settable outcome status (default, no overrides).
    $outcomes = ['ATTENDED', 'FREE', 'CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT'];
    foreach ($outcomes as $i => $status) {
        $session = ($this->juneSession)(['scheduled_at_utc' => sprintf('2026-06-%02d 10:00:00+00', $i + 1)]);
        ($this->attend)($session, $status)->assertOk();

        $shouldPay = SessionClassifier::countsForTeacher(SessionStatus::from($status));
        expect(($this->linesForSession)($session)->count())->toBe($shouldPay ? 1 : 0);
    }
});

// ─── Reversal & immutability ──────────────────────────────────────────────────

it('TC-8.8: ATTENDED → cancellation before finalize → line removed, total reduced, guard cleared', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();
    expect((int) ($this->payoutFor)()->total_minor)->toBe(5000);

    ($this->attend)($session, 'CANCELLED_BY_STUDENT')->assertOk();

    expect(($this->linesForSession)($session))->toHaveCount(0)
        ->and((int) ($this->payoutFor)()->total_minor)->toBe(0);
    expect((bool) DB::table('sessions')->where('id', $session)->value('paid_to_teacher'))->toBeFalse();
});

it('TC-8.9: ATTENDED → cancellation after finalize → rejected (payout immutable)', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();

    app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');

    // The reversal attempt is rejected; the response is a 422 and the line survives.
    ($this->attend)($session, 'CANCELLED_BY_STUDENT')->assertStatus(422);

    expect(($this->linesForSession)($session))->toHaveCount(1)
        ->and((int) ($this->payoutFor)()->total_minor)->toBe(5000);
    // The whole outcome rolled back: status & guard unchanged.
    $this->asAcademy($this->academy);
    $row = DB::table('sessions')->where('id', $session)->first();
    expect($row->status)->toBe('ATTENDED')
        ->and((bool) $row->paid_to_teacher)->toBeTrue();
});

it('TC-8.10: after finalize, inserting a payout line is rejected by the DB trigger', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();
    $payout = ($this->payoutFor)();

    app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');

    $other = ($this->juneSession)(['scheduled_at_utc' => '2026-06-04 10:00:00+00']);
    $this->asAcademy($this->academy);

    expect(fn () => DB::table('payout_line_items')->insert([
        'id'           => (string) Str::uuid(),
        'academy_id'   => $this->academy,
        'payout_id'    => $payout->id,
        'session_id'   => $other,
        'amount_minor' => 5000,
        'currency'     => 'EGP',
    ]))->toThrow(QueryException::class);
});

it('TC-8.11: after finalize, modifying total_minor directly is rejected by the DB trigger', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();
    $payout = ($this->payoutFor)();

    app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');

    $this->asAcademy($this->academy);
    expect(fn () => DB::table('payouts')->where('id', $payout->id)->update(['total_minor' => 999999]))
        ->toThrow(QueryException::class);
});

it('TC-8.12: finalize is idempotent — no double audit, no change', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();

    $svc = app(Payroll::class);
    $first = $svc->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');
    $finalizedAt = ($this->payoutFor)()->finalized_at;

    $second = $svc->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');

    expect($first)->toBe(1)->and($second)->toBe(0); // nothing OPEN the second time
    expect(($this->payoutFor)()->finalized_at)->toBe($finalizedAt);

    $this->asAcademy($this->academy);
    $audits = DB::table('audit_log')
        ->where('action', 'payout.finalized')
        ->where('entity_id', ($this->payoutFor)()->id)
        ->count();
    expect($audits)->toBe(1);
});

it('TC-8.13: pre-finalize integrity check fails loudly when total != sum(lines)', function () {
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();
    $payout = ($this->payoutFor)();

    // Corrupt the total on the still-OPEN payout (the immutability trigger only guards finalized rows).
    $this->asAcademy($this->academy);
    DB::table('payouts')->where('id', $payout->id)->update(['total_minor' => 12345]);

    expect(fn () => app(Payroll::class)->finalizePayout((string) $payout->id, $this->academy, $this->owner->id, 'ACADEMY_OWNER'))
        ->toThrow(RuntimeException::class);

    // Still OPEN — the bad statement was not sealed.
    expect(($this->payoutFor)()->finalized_at)->toBeNull();
});

// ─── Attribution ──────────────────────────────────────────────────────────────

it('TC-8.14: a rescheduled session delivered by the same teacher attributes the payout to that teacher', function () {
    // Reschedule simply keeps the same teacher_id; the payout follows sessions.teacher_id.
    $session = ($this->juneSession)(['scheduled_at_utc' => '2026-06-05 10:00:00+00']);
    ($this->attend)($session)->assertOk();

    $payout = ($this->payoutFor)();
    expect($payout)->not->toBeNull()
        ->and((string) $payout->teacher_id)->toBe($this->teacher)
        ->and((int) $payout->total_minor)->toBe(5000);
});

it('TC-8.15: future sessions pay the NEW teacher after reassignment; past sessions stay with the original', function () {
    $teacherB = $this->createTeacher($this->academy, ['session_rate_minor' => 7000, 'currency' => 'EGP']);

    // A past session delivered by teacher A.
    $sA = ($this->juneSession)(['scheduled_at_utc' => '2026-06-01 10:00:00+00', 'teacher_id' => $this->teacher]);
    ($this->attend)($sA)->assertOk();

    // A future-of-A session reassigned to teacher B (Sprint 5 captures teacher_id on the session).
    $sB = ($this->juneSession)(['scheduled_at_utc' => '2026-06-08 10:00:00+00', 'teacher_id' => $teacherB]);
    ($this->attend)($sB)->assertOk();

    expect((int) ($this->payoutFor)($this->teacher)->total_minor)->toBe(5000)
        ->and((int) ($this->payoutFor)($teacherB)->total_minor)->toBe(7000);

    expect((string) ($this->linesForSession)($sA)->first()->amount_minor)->toBe('5000')
        ->and((string) ($this->linesForSession)($sB)->first()->amount_minor)->toBe('7000');
});

// ─── Roles, isolation, profit ─────────────────────────────────────────────────

it('TC-8.16: a teacher sees only their own payouts; the all-payouts list is 403; another teacher\'s payout is forbidden', function () {
    // Owner accrues a payout for the linked teacher and for a second teacher.
    $sOwn = ($this->juneSession)();
    ($this->attend)($sOwn)->assertOk();

    $teacherB = $this->createTeacher($this->academy, ['session_rate_minor' => 6000, 'currency' => 'EGP']);
    $sB = ($this->juneSession)(['scheduled_at_utc' => '2026-06-09 10:00:00+00', 'teacher_id' => $teacherB]);
    ($this->attend)($sB)->assertOk();

    $ownPayoutId = ($this->payoutFor)($this->teacher)->id;
    $otherPayoutId = ($this->payoutFor)($teacherB)->id;

    Sanctum::actingAs($this->teacherUser);

    // Own list: exactly one, the teacher's own.
    $me = $this->getJson('/api/me/payouts')->assertOk();
    expect($me->json('total'))->toBe(1)
        ->and($me->json('rows.0.id'))->toBe($ownPayoutId);

    // The all-teachers list and another teacher's detail are forbidden.
    $this->getJson('/api/payouts')->assertStatus(403);
    $this->getJson("/api/payouts/{$otherPayoutId}")->assertStatus(403);

    // Own detail is allowed.
    $this->getJson("/api/payouts/{$ownPayoutId}")->assertOk();
});

it('TC-8.17: a teacher cannot access the profit summary', function () {
    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/reports/profit-summary?year=2026&month=6')->assertStatus(403);
});

it('TC-8.18: owner profit summary revenue counts amounts actually paid, not closed-but-unpaid totals', function () {
    $s1 = ($this->juneSession)();
    $s2 = ($this->juneSession)(['scheduled_at_utc' => '2026-06-02 10:00:00+00']);
    ($this->attend)($s1)->assertOk();
    ($this->attend)($s2)->assertOk();

    // Close the period's invoices. CLOSED is money owed, not money received.
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/invoices/close', ['year' => 2026, 'month' => 6])->assertOk();

    // Closed but unpaid → revenue 0 (the bug was counting due totals here).
    $egp = collect($this->getJson('/api/reports/profit-summary?year=2026&month=6')->assertOk()->json('rows'))
        ->firstWhere('currency', 'EGP');
    expect((int) $egp['revenue_minor'])->toBe(0)
        ->and((int) $egp['payouts_minor'])->toBe(10000)
        ->and((int) $egp['profit_minor'])->toBe(-10000);

    // Mark both invoices fully paid → revenue now reflects cash received.
    $invoiceIds = DB::table('invoices')
        ->where('period_year', 2026)->where('period_month', 6)
        ->where('status', 'CLOSED')->pluck('id');
    foreach ($invoiceIds as $invoiceId) {
        $this->postJson("/api/invoices/{$invoiceId}/mark-paid", ['payment_method' => 'CASH'])->assertOk();
    }

    $egp = collect($this->getJson('/api/reports/profit-summary?year=2026&month=6')->assertOk()->json('rows'))
        ->firstWhere('currency', 'EGP');

    // Revenue 2 × 10 000 = 20 000 paid; payouts 2 × 5 000 = 10 000; profit 10 000.
    expect((int) $egp['revenue_minor'])->toBe(20000)
        ->and((int) $egp['payouts_minor'])->toBe(10000)
        ->and((int) $egp['profit_minor'])->toBe(10000);
});

it('TC-8.19: mixed currencies → separate per-currency profit rows; nothing summed across currencies', function () {
    // EGP attended session (existing student/teacher).
    $egpSession = ($this->juneSession)();
    ($this->attend)($egpSession)->assertOk();

    // SAR teacher + SAR student/guardian + SAR subscription.
    $sarTeacher  = $this->createTeacher($this->academy, ['session_rate_minor' => 3000, 'currency' => 'SAR']);
    $sarGuardian = $this->createGuardian($this->academy, ['currency' => 'SAR']);
    $sarStudent  = $this->createStudent($this->academy, $sarGuardian);

    $this->asAcademy($this->academy);
    DB::table('subscriptions')->insert([
        'id'                 => (string) Str::uuid(),
        'academy_id'         => $this->academy,
        'student_id'         => $sarStudent,
        'plan_label'         => '1:1 SAR',
        'price_minor'        => 9000,
        'currency'           => 'SAR',
        'price_basis'        => 'PER_SESSION',
        'sessions_per_month' => null,
        'status'             => 'ACTIVE',
        'start_date'         => '2026-01-01',
    ]);

    $sarSession = $this->createSession($this->academy, $sarStudent, $sarTeacher, [
        'scheduled_at_utc' => '2026-06-06 10:00:00+00',
        'duration_minutes' => 60,
        'status'           => 'SCHEDULED',
    ]);
    ($this->attend)($sarSession)->assertOk();

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/invoices/close', ['year' => 2026, 'month' => 6])->assertOk();

    // EGP paid in full; SAR only partially paid (4 000 of 9 000). Revenue follows cash received.
    $egpInvoice = DB::table('invoices')->where('currency', 'EGP')
        ->where('period_year', 2026)->where('period_month', 6)->value('id');
    $sarInvoice = DB::table('invoices')->where('currency', 'SAR')
        ->where('period_year', 2026)->where('period_month', 6)->value('id');
    $this->postJson("/api/invoices/{$egpInvoice}/mark-paid", ['payment_method' => 'CASH'])->assertOk();
    $this->postJson("/api/invoices/{$sarInvoice}/mark-paid", ['payment_method' => 'CASH', 'amount_paid_minor' => 4000])->assertOk();

    $rows = collect($this->getJson('/api/reports/profit-summary?year=2026&month=6')->assertOk()->json('rows'));

    $egp = $rows->firstWhere('currency', 'EGP');
    $sar = $rows->firstWhere('currency', 'SAR');

    expect((int) $egp['revenue_minor'])->toBe(10000)
        ->and((int) $egp['payouts_minor'])->toBe(5000)
        ->and((int) $egp['profit_minor'])->toBe(5000);

    // SAR revenue is the 4 000 actually paid, not the 9 000 invoiced.
    expect((int) $sar['revenue_minor'])->toBe(4000)
        ->and((int) $sar['payouts_minor'])->toBe(3000)
        ->and((int) $sar['profit_minor'])->toBe(1000);

    // Two distinct rows — never collapsed into one.
    expect($rows)->toHaveCount(2);
});

it('TC-8.20: owner of academy A cannot read academy B\'s payouts (RLS)', function () {
    // Accrue a payout in academy A.
    $session = ($this->juneSession)();
    ($this->attend)($session)->assertOk();
    $aPayoutId = ($this->payoutFor)()->id;

    // A second academy B with its own owner (PRO plan so its owner clears the payroll gate).
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $academyB = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'plan_id' => $proPlan]);
    $ownerB = $this->makeUser($academyB, 'ACADEMY_OWNER', ['email' => 'owner-b-pay@test.local']);

    Sanctum::actingAs($ownerB);

    // B's owner cannot see A's payout (RLS hides the row → 404) and the list excludes it.
    $this->getJson("/api/payouts/{$aPayoutId}")->assertStatus(404);
    $list = $this->getJson('/api/payouts')->assertOk();
    expect(collect($list->json('rows'))->pluck('id'))->not->toContain($aPayoutId);
});

// ─── Audit ────────────────────────────────────────────────────────────────────

it('TC-8.21: accrue, reverse, and finalize each write audit entries with the relevant totals', function () {
    $session = ($this->juneSession)();

    // Accrue.
    ($this->attend)($session)->assertOk();
    $payoutId = ($this->payoutFor)()->id;

    $this->asAcademy($this->academy);
    $accrued = DB::table('audit_log')->where('action', 'payout.line_accrued')->where('entity_id', $payoutId)->first();
    expect($accrued)->not->toBeNull()
        ->and(json_decode($accrued->after, true)['amount_minor'])->toBe(5000);

    // Reverse.
    ($this->attend)($session, 'CANCELLED_BY_STUDENT')->assertOk();
    $this->asAcademy($this->academy);
    $reversed = DB::table('audit_log')->where('action', 'payout.line_reversed')->where('entity_id', $payoutId)->first();
    expect($reversed)->not->toBeNull()
        ->and(json_decode($reversed->before, true)['amount_minor'])->toBe(5000);

    // Re-accrue then finalize.
    ($this->attend)($session)->assertOk();
    app(Payroll::class)->finalizePeriodPayouts($this->academy, 2026, 6, $this->owner->id, 'ACADEMY_OWNER');

    $this->asAcademy($this->academy);
    $finalized = DB::table('audit_log')->where('action', 'payout.finalized')->where('entity_id', $payoutId)->first();
    expect($finalized)->not->toBeNull()
        ->and(json_decode($finalized->after, true)['total_minor'])->toBe(5000);
});
