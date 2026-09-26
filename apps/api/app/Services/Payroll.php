<?php

declare(strict_types=1);

namespace App\Services;

use App\Payroll\PayoutHook;
use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Sprint 8 real payroll implementation — the SECOND money document, structurally parallel to
 * {@see Invoicing}. Where invoicing bills the student, this pays the teacher, from the SAME
 * session data and the SAME {@see \App\Domain\SessionClassifier} truth: only an ATTENDED session
 * pays, at the teacher's hourly rate pro-rated by the session length + currency, snapshotted at
 * attendance time (R-PAY-1/3, decision §2). One payout per teacher per period; totals maintained
 * transactionally; immutable after finalize.
 *
 * WHICH hourly rate depends on the teacher's `pay_type` (see {@see lessonPayMinor}): one rate for
 * everyone (HOURLY), the student's own rate with the teacher's as the fallback (PER_STUDENT), or
 * nothing per lesson at all (FIXED) — a fixed-salary teacher is paid `fixed_salary_minor` a month,
 * carried on the statement as `base_minor`. Net = base + Σ lines + rewards − deductions.
 *
 * Idempotency contract: the caller (AttendanceService) guards via `sessions.paid_to_teacher`; this
 * service also uses `insertOrIgnore` on the unique `(payout_id, session_id)` constraint as a
 * concurrency backstop so a duplicate line can never be created (R-PAY-2, decision §3.3).
 *
 * All writes run inside the caller's tenant transaction (GUCs already set), so every DB write is
 * RLS-scoped to the session's academy automatically.
 */
final class Payroll implements PayoutHook
{
    // -------------------------------------------------------------------------
    // PayoutHook
    // -------------------------------------------------------------------------

    /**
     * A session became ATTENDED → snapshot the teacher's rate and ensure exactly one line item
     * exists on the teacher's OPEN payout for the period.
     */
    public function onSessionAttended(object $session): void
    {
        $academy = DB::table('academies')->where('id', $session->academy_id)->first();
        if ($academy === null) {
            return;
        }

        // Attribution follows the session's teacher — the actual deliverer (decision §4),
        // already reflecting any reschedule/reassignment captured at generation time.
        $teacher = DB::table('teachers')->where('id', $session->teacher_id)->first();
        if ($teacher === null) {
            return; // Defensive: a session with no resolvable teacher cannot accrue pay.
        }

        $tz    = $academy->timezone ?: 'UTC';
        $local = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz);
        $year  = (int) $local->year;
        $month = (int) $local->month;

        // Snapshot NOW — later rate edits (Sprint 4) must not rewrite this line (R-PAY-1/3).
        $amountMinor = $this->linePayMinor($teacher, $session);
        $currency    = (string) $teacher->currency;

        $payoutId = $this->ensureOpenPayout($academy, $teacher, $year, $month);

        // Idempotency: if a line already exists for this session, do nothing.
        $exists = DB::table('payout_line_items')
            ->where('payout_id', $payoutId)
            ->where('session_id', $session->id)
            ->exists();

        if ($exists) {
            return;
        }

        $sessionDate = $local->format('Y-m-d');

        // insertOrIgnore is the concurrency backstop for the unique (payout_id, session_id)
        // constraint — even in a race a duplicate line cannot be created (R-PAY-2).
        $inserted = DB::table('payout_line_items')->insertOrIgnore([
            'id'           => (string) Str::uuid(),
            'academy_id'   => $session->academy_id,
            'payout_id'    => $payoutId,
            'session_id'   => $session->id,
            'amount_minor' => $amountMinor,
            'currency'     => $currency,
            'session_date' => $sessionDate,
            'created_at'   => now(),
        ]);

        if ($inserted) {
            DB::table('payouts')
                ->where('id', $payoutId)
                ->update([
                    'total_minor' => DB::raw("total_minor + {$amountMinor}"),
                    'updated_at'  => now(),
                ]);

            Audit::log(
                'payout.line_accrued',
                'payout',
                $payoutId,
                (string) $session->academy_id,
                null,
                'SUPER_ADMIN',
                after: [
                    'session_id'   => $session->id,
                    'teacher_id'   => $session->teacher_id,
                    'amount_minor' => $amountMinor,
                    'currency'     => $currency,
                ],
            );

            // The month's gross just moved, so any percent-based quality deduction hanging off
            // this statement is now stale — a MONTHLY report docks a % of exactly this total.
            $this->quality()->syncPayout($payoutId);
        }
    }

    /**
     * A session is no longer ATTENDED (corrected before the payout was finalized) → remove its
     * pending line item and reverse the payout total. Rejects if the payout is finalized.
     */
    public function onSessionUnattended(object $session): void
    {
        $line = DB::table('payout_line_items')
            ->where('session_id', $session->id)
            ->first();

        if ($line === null) {
            return; // Already gone — idempotent.
        }

        $payoutId    = (string) $line->payout_id;
        $amountMinor = (int) $line->amount_minor;
        $academyId   = (string) $line->academy_id;

        $payout = DB::table('payouts')->where('id', $payoutId)->first();

        if ($payout !== null && $payout->finalized_at !== null) {
            // R-PAY immutability: a finalized payout reflects money paid in the real world.
            throw ValidationException::withMessages([
                'payout' => [
                    'Cannot reverse: this teacher\'s payout is already finalized. / لا يمكن التراجع: كشف راتب هذا المدرس نهائي بالفعل.',
                ],
            ]);
        }

        DB::table('payout_line_items')->where('id', $line->id)->delete();

        DB::table('payouts')
            ->where('id', $payoutId)
            ->update([
                'total_minor' => DB::raw("total_minor - {$amountMinor}"),
                'updated_at'  => now(),
            ]);

        Audit::log(
            'payout.line_reversed',
            'payout',
            $payoutId,
            $academyId,
            null,
            'SUPER_ADMIN',
            before: [
                'session_id'   => $session->id,
                'amount_minor' => $amountMinor,
            ],
        );

        // The month's gross shrank — re-derive the percent-based quality deductions against it.
        $this->quality()->syncPayout($payoutId);
    }

    // -------------------------------------------------------------------------
    // Public management operations
    // -------------------------------------------------------------------------

    /**
     * Finalize a single OPEN payout, verifying its total integrity first. Idempotent — an
     * already-finalized payout is a no-op (no double audit, no change).
     *
     * @throws \RuntimeException if total_minor ≠ sum of line items (integrity, AC-8.7)
     */
    public function finalizePayout(
        string $payoutId,
        string $academyId,
        string $actorUserId,
        string $actorRole,
    ): void {
        $payout = DB::table('payouts')
            ->where('id', $payoutId)
            ->where('academy_id', $academyId)
            ->first();

        if ($payout === null) {
            return;
        }

        // Idempotent — already finalized.
        if ($payout->finalized_at !== null) {
            return;
        }

        // Settle the derived quality deductions against the period's FINAL gross before sealing:
        // a MONTHLY report docks a % of the month's total pay, and this is the last moment that
        // total can still move. After finalize the DB triggers freeze the row for good.
        $this->quality()->syncPayout($payoutId);
        $payout = DB::table('payouts')->where('id', $payoutId)->first();
        if ($payout === null) {
            return;
        }

        // Integrity check: net total must equal base + sessions + rewards − deductions (AC-8.7,
        // extended for adjustments and the fixed salary). sessions = sum of per-session lines.
        $lineSum = (int) DB::table('payout_line_items')
            ->where('payout_id', $payoutId)
            ->sum('amount_minor');

        $expected = (int) $payout->base_minor + $lineSum + (int) $payout->rewards_minor - (int) $payout->deductions_minor;

        if ((int) $payout->total_minor !== $expected) {
            throw new \RuntimeException(
                "Payout {$payoutId} integrity failure: total_minor={$payout->total_minor} but "
                . "base({$payout->base_minor}) + sessions({$lineSum}) + rewards({$payout->rewards_minor}) − deductions({$payout->deductions_minor}) = {$expected}."
            );
        }

        $finalizedAt = now();

        DB::table('payouts')
            ->where('id', $payoutId)
            ->update([
                'finalized_at' => $finalizedAt,
                'updated_at'   => $finalizedAt,
            ]);

        Audit::log(
            'payout.finalized',
            'payout',
            $payoutId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: [
                'finalized_at' => $finalizedAt->toIso8601String(),
                'total_minor'  => (int) $payout->total_minor,
            ],
        );
    }

    /**
     * Finalize all OPEN payouts for an academy in the given period.
     *
     * @return int number of payouts actually finalized
     */
    public function finalizePeriodPayouts(
        string $academyId,
        int $year,
        int $month,
        string $actorUserId,
        string $actorRole,
    ): int {
        $payouts = DB::table('payouts')
            ->where('academy_id', $academyId)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->whereNull('finalized_at')
            ->get(['id']);

        $finalized = 0;
        foreach ($payouts as $payout) {
            $this->finalizePayout((string) $payout->id, $academyId, $actorUserId, $actorRole);
            $finalized++;
        }

        return $finalized;
    }

    // -------------------------------------------------------------------------
    // Adjustments — owner-entered REWARDS (bonuses) and DEDUCTIONS
    // -------------------------------------------------------------------------

    /**
     * Add a REWARD or DEDUCTION to an OPEN payout, with a required reason and optional details.
     * The amount is stored positive; the type decides the sign applied to the running subtotals
     * and the net total. Rejected if the payout is finalized (immutability).
     *
     * @return string the new adjustment UUID
     *
     * @throws ValidationException if the payout is missing/finalized, the type is invalid, or
     *                             the amount is non-positive.
     */
    public function addAdjustment(
        string $payoutId,
        string $academyId,
        string $type,
        int $amountMinor,
        string $reason,
        ?string $details,
        string $actorUserId,
        string $actorRole,
    ): string {
        $type = strtoupper($type);

        if (! in_array($type, ['REWARD', 'DEDUCTION'], true)) {
            throw ValidationException::withMessages(['type' => ['Adjustment type must be REWARD or DEDUCTION.']]);
        }
        if ($amountMinor <= 0) {
            throw ValidationException::withMessages(['amount_minor' => ['Amount must be greater than zero.']]);
        }
        if (trim($reason) === '') {
            throw ValidationException::withMessages(['reason' => ['A reason is required.']]);
        }

        $payout = DB::table('payouts')
            ->where('id', $payoutId)
            ->where('academy_id', $academyId)
            ->first();

        if ($payout === null) {
            throw ValidationException::withMessages(['payout' => ['Payout not found.']]);
        }
        if ($payout->finalized_at !== null) {
            throw ValidationException::withMessages([
                'payout' => ['Cannot adjust a finalized payout. / لا يمكن تعديل كشف راتب نهائي.'],
            ]);
        }

        $id = (string) Str::uuid();

        DB::table('payout_adjustments')->insert([
            'id'           => $id,
            'academy_id'   => $academyId,
            'payout_id'    => $payoutId,
            'type'         => $type,
            'amount_minor' => $amountMinor,
            'currency'     => $payout->currency,   // inherit the statement currency (no FX)
            'reason'       => $reason,
            'details'      => $details,
            'created_by'   => $actorUserId,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $delta = $type === 'REWARD' ? 'rewards_minor' : 'deductions_minor';
        $totalOp = $type === 'REWARD' ? '+' : '-';

        DB::table('payouts')
            ->where('id', $payoutId)
            ->update([
                $delta        => DB::raw("{$delta} + {$amountMinor}"),
                'total_minor' => DB::raw("total_minor {$totalOp} {$amountMinor}"),
                'updated_at'  => now(),
            ]);

        Audit::log(
            'payout.adjustment_added',
            'payout',
            $payoutId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: [
                'adjustment_id' => $id,
                'type'          => $type,
                'amount_minor'  => $amountMinor,
                'reason'        => $reason,
            ],
        );

        return $id;
    }

    /**
     * Remove an adjustment from an OPEN payout, reversing its effect on the subtotals and the net
     * total. Rejected if the payout is finalized. Idempotent — a missing adjustment is a no-op.
     */
    public function removeAdjustment(
        string $adjustmentId,
        string $academyId,
        string $actorUserId,
        string $actorRole,
    ): void {
        $adjustment = DB::table('payout_adjustments')
            ->where('id', $adjustmentId)
            ->where('academy_id', $academyId)
            ->first();

        if ($adjustment === null) {
            return; // Already gone — idempotent.
        }

        $payout = DB::table('payouts')->where('id', $adjustment->payout_id)->first();

        if ($payout !== null && $payout->finalized_at !== null) {
            throw ValidationException::withMessages([
                'payout' => ['Cannot adjust a finalized payout. / لا يمكن تعديل كشف راتب نهائي.'],
            ]);
        }

        $amountMinor = (int) $adjustment->amount_minor;
        $isReward    = $adjustment->type === 'REWARD';

        DB::table('payout_adjustments')->where('id', $adjustmentId)->delete();

        $delta   = $isReward ? 'rewards_minor' : 'deductions_minor';
        $totalOp = $isReward ? '-' : '+';

        DB::table('payouts')
            ->where('id', $adjustment->payout_id)
            ->update([
                $delta        => DB::raw("{$delta} - {$amountMinor}"),
                'total_minor' => DB::raw("total_minor {$totalOp} {$amountMinor}"),
                'updated_at'  => now(),
            ]);

        Audit::log(
            'payout.adjustment_removed',
            'payout',
            (string) $adjustment->payout_id,
            $academyId,
            $actorUserId,
            $actorRole,
            before: [
                'adjustment_id' => $adjustmentId,
                'type'          => $adjustment->type,
                'amount_minor'  => $amountMinor,
                'reason'        => $adjustment->reason,
            ],
        );
    }

    // -------------------------------------------------------------------------
    // Pay types — HOURLY, PER_STUDENT, FIXED
    // -------------------------------------------------------------------------

    public const PAY_HOURLY = 'HOURLY';

    public const PAY_PER_STUDENT = 'PER_STUDENT';

    public const PAY_FIXED = 'FIXED';

    public const PAY_TYPES = [self::PAY_HOURLY, self::PAY_PER_STUDENT, self::PAY_FIXED];

    /**
     * What one lesson with this student pays the teacher, before any free-trial zeroing — THE
     * pricing rule, shared by attendance, re-pricing and the unmarked-lesson sweep so the three
     * can never disagree about what a lesson is worth.
     *
     * Every rate is HOURLY and pro-rated by the lesson's length (a 30-min lesson at 50/hr pays
     * 25). PER_STUDENT takes the student's own rate when one is set and the teacher's rate
     * otherwise. FIXED pays nothing per lesson: the month's salary is the pay.
     */
    public function lessonPayMinor(object $teacher, ?string $studentId, int $durationMinutes): int
    {
        $payType = (string) ($teacher->pay_type ?? self::PAY_HOURLY);

        if ($payType === self::PAY_FIXED) {
            return 0;
        }

        $hourlyRateMinor = (int) $teacher->session_rate_minor;

        if ($payType === self::PAY_PER_STUDENT && $studentId !== null) {
            $own = DB::table('teacher_student_rates')
                ->where('teacher_id', $teacher->id)
                ->where('student_id', $studentId)
                ->value('rate_minor');
            if ($own !== null) {
                $hourlyRateMinor = (int) $own;
            }
        }

        return (int) round($hourlyRateMinor * $durationMinutes / 60);
    }

    /** The month's fixed salary a teacher is owed — 0 for anyone paid by the lesson. */
    public static function baseSalaryMinor(object $teacher): int
    {
        return ($teacher->pay_type ?? self::PAY_HOURLY) === self::PAY_FIXED
            ? (int) $teacher->fixed_salary_minor
            : 0;
    }

    /**
     * Bring the teacher's CURRENT month's statement in line with their fixed salary, after their
     * pay setup changed (switched to/from FIXED, or the salary itself moved).
     *
     * Only the current month: last month's statement, still open until the 3rd, was earned under
     * the old terms. When a salary is owed and there is no statement yet, one is opened — so a
     * fixed-salary teacher shows on payroll from day one instead of from their first lesson.
     * Moves the net by the DELTA, never by restating it (the finalize integrity check).
     */
    public function syncFixedSalary(string $teacherId, ?string $actorUserId = null, string $actorRole = 'SUPER_ADMIN'): void
    {
        $teacher = DB::table('teachers')->where('id', $teacherId)->first();
        if ($teacher === null || $teacher->deleted_at !== null) {
            return;
        }

        $academy = DB::table('academies')->where('id', $teacher->academy_id)->first();
        if ($academy === null) {
            return;
        }

        [$year, $month] = $this->currentPeriod($academy);
        $base = self::baseSalaryMinor($teacher);

        $payout = DB::table('payouts')
            ->where('teacher_id', $teacherId)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->first();

        if ($payout === null) {
            if ($base > 0) {
                $this->ensureOpenPayout($academy, $teacher, $year, $month);
            }

            return;
        }

        // A sealed statement is money already paid; a statement in another currency cannot take
        // a salary quoted in this one without inventing an exchange rate.
        if ($payout->finalized_at !== null || $payout->currency !== $teacher->currency) {
            return;
        }

        $this->moveBase($payout, $base, $actorUserId, $actorRole);
    }

    /**
     * Open this month's statement for every active fixed-salary teacher who has none yet. Run
     * daily by {@see \App\Jobs\OpenFixedSalaryPayoutsJob}: a salaried teacher is owed their pay
     * whether or not they taught, so their statement cannot wait for an attended lesson to exist.
     *
     * @return int statements opened
     */
    public function openFixedSalaryPayouts(string $academyId): int
    {
        $academy = DB::table('academies')->where('id', $academyId)->first();
        if ($academy === null) {
            return 0;
        }

        [$year, $month] = $this->currentPeriod($academy);

        $teachers = DB::table('teachers as t')
            ->where('t.pay_type', self::PAY_FIXED)
            ->where('t.fixed_salary_minor', '>', 0)
            ->where('t.is_active', true)
            ->whereNull('t.deleted_at')
            ->whereNotExists(function ($q) use ($year, $month) {
                $q->select(DB::raw(1))
                    ->from('payouts as p')
                    ->whereColumn('p.teacher_id', 't.id')
                    ->where('p.period_year', $year)
                    ->where('p.period_month', $month);
            })
            ->get(['t.*']);

        foreach ($teachers as $teacher) {
            $this->ensureOpenPayout($academy, $teacher, $year, $month);
        }

        return $teachers->count();
    }

    /**
     * Re-price an OPEN statement against the teacher's CURRENT pay setup: every lesson line at
     * today's rate for its student, and the fixed salary at today's amount.
     *
     * Lines are snapshotted at attendance on purpose (R-PAY-1/3), so a rate set AFTER lessons were
     * marked — the common case when an academy configures pay mid-month — would otherwise never
     * reach them. This is the owner's explicit "apply the new rates to this month", never an
     * automatic side effect of editing a teacher. Each line moves by its own delta and the net by
     * their sum, so the finalize integrity check still means something.
     *
     * @return int the net change applied to the statement (may be negative or zero)
     *
     * @throws ValidationException missing/finalized statement, or a currency that no longer matches
     */
    public function repricePayout(string $payoutId, string $academyId, string $actorUserId, string $actorRole): int
    {
        $payout = DB::table('payouts')
            ->where('id', $payoutId)
            ->where('academy_id', $academyId)
            ->first();

        if ($payout === null) {
            throw ValidationException::withMessages(['payout' => ['Payout not found.']]);
        }
        if ($payout->finalized_at !== null) {
            throw ValidationException::withMessages([
                'payout' => ['Cannot recalculate a finalized payout. / لا يمكن إعادة حساب كشف راتب نهائي.'],
            ]);
        }

        $teacher = DB::table('teachers')->where('id', $payout->teacher_id)->first();
        if ($teacher === null) {
            throw ValidationException::withMessages(['payout' => ['The teacher on this statement no longer exists.']]);
        }
        if ($teacher->currency !== $payout->currency) {
            throw ValidationException::withMessages([
                'payout' => [
                    "This statement is in {$payout->currency} but the teacher is now paid in {$teacher->currency}; it cannot be recalculated. / "
                    ."هذا الكشف بعملة {$payout->currency} بينما أجر المعلم الآن بعملة {$teacher->currency}؛ لا يمكن إعادة حسابه.",
                ],
            ]);
        }

        $lines = DB::table('payout_line_items as li')
            ->join('sessions as se', 'se.id', '=', 'li.session_id')
            ->where('li.payout_id', $payoutId)
            ->get(['li.id', 'li.amount_minor', 'se.id as session_id', 'se.student_id', 'se.duration_minutes']);

        $linesDelta = 0;
        $linesChanged = 0;
        foreach ($lines as $line) {
            $session = (object) [
                'id' => $line->session_id,
                'student_id' => $line->student_id,
                'duration_minutes' => $line->duration_minutes,
            ];
            $fresh = $this->linePayMinor($teacher, $session);
            $delta = $fresh - (int) $line->amount_minor;
            if ($delta === 0) {
                continue;
            }

            DB::table('payout_line_items')->where('id', $line->id)->update(['amount_minor' => $fresh]);
            $linesDelta += $delta;
            $linesChanged++;
        }

        $baseBefore = (int) $payout->base_minor;
        $baseAfter = self::baseSalaryMinor($teacher);

        if ($linesDelta === 0 && $baseAfter === $baseBefore) {
            return 0;
        }

        DB::table('payouts')
            ->where('id', $payoutId)
            ->update([
                'base_minor' => DB::raw('base_minor + '.($baseAfter - $baseBefore)),
                'total_minor' => DB::raw('total_minor + '.($linesDelta + $baseAfter - $baseBefore)),
                'updated_at' => now(),
            ]);

        Audit::log(
            'payout.repriced',
            'payout',
            $payoutId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: [
                'pay_type' => $teacher->pay_type,
                'lines_changed' => $linesChanged,
                'lines_delta_minor' => $linesDelta,
                'base_minor' => $baseAfter,
                'total_minor' => (int) $payout->total_minor + $linesDelta + $baseAfter - $baseBefore,
            ],
            before: [
                'base_minor' => $baseBefore,
                'total_minor' => (int) $payout->total_minor,
            ],
        );

        // The gross moved — re-derive the percent-based quality deductions against it.
        $this->quality()->syncPayout($payoutId);

        return $linesDelta + $baseAfter - $baseBefore;
    }

    // -------------------------------------------------------------------------
    // Derived-adjustment support (teacher quality + the auto-deduction sweep)
    // -------------------------------------------------------------------------

    /**
     * Find or open the OPEN monthly payout for a teacher/period, resolving the academy and the
     * teacher's currency itself.
     *
     * Attendance is normally what brings a statement into being ({@see onSessionAttended}), but the
     * two automatic writers need one BEFORE any pay has accrued — and the sharpest case is exactly
     * that: the auto-deduction sweep fires because a teacher never marked a session, so that
     * teacher may have no line items and therefore no statement at all to hang the deduction on.
     * Returns null when the academy or teacher can't be resolved.
     */
    public function ensureOpenPayoutFor(string $academyId, string $teacherId, int $year, int $month): ?string
    {
        $academy = DB::table('academies')->where('id', $academyId)->first();
        $teacher = DB::table('teachers')->where('id', $teacherId)->first();

        if ($academy === null || $teacher === null) {
            return null;
        }

        return $this->ensureOpenPayout($academy, $teacher, $year, $month);
    }

    /**
     * What one session pays the teacher on this statement — the snapshotted line, or 0 when no line
     * exists (the session isn't ATTENDED, so it earned nothing). A SESSION-scoped quality report
     * bites into exactly this: dock a % of what the lesson paid, and a lesson that paid nothing
     * costs nothing. If it is marked ATTENDED later the line appears and the refresh picks it up.
     */
    public function sessionLineAmountMinor(string $payoutId, string $sessionId): int
    {
        return (int) DB::table('payout_line_items')
            ->where('payout_id', $payoutId)
            ->where('session_id', $sessionId)
            ->value('amount_minor');
    }

    /**
     * The period's GROSS pay, before rewards/deductions: the fixed salary (0 unless the teacher is
     * on one) plus Σ of the per-session lines. This is the base a MONTHLY quality report docks its
     * percent from ("% of the total salary at the end of the month") — for a fixed-salary teacher
     * that IS the salary, since their lessons each pay 0 — and it moves until the statement is
     * finalized.
     */
    public function grossMinor(string $payoutId): int
    {
        $base = (int) DB::table('payouts')->where('id', $payoutId)->value('base_minor');

        return $base + (int) DB::table('payout_line_items')
            ->where('payout_id', $payoutId)
            ->sum('amount_minor');
    }

    /** Resolved lazily: TeacherQuality depends on Payroll, so a constructor edge would cycle. */
    private function quality(): TeacherQuality
    {
        return app(TeacherQuality::class);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Re-derive a session's payout line from current truth — used when the free-trial flag is
     * toggled AFTER attendance was already recorded (the UI records attendance first, then saves
     * the report carrying `is_free_trial`). Remove + re-add reuses the normal rate snapshot logic
     * and picks up the now-current trial flag via {@see onSessionAttended}. No-op if the session
     * has no payout line yet, or if its payout is already finalized — money already paid out
     * cannot be retroactively unpaid by a later report edit.
     */
    public function repriceFreeTrial(object $session): void
    {
        $line = DB::table('payout_line_items')->where('session_id', $session->id)->first();
        if ($line === null) {
            return;
        }

        $payout = DB::table('payouts')->where('id', $line->payout_id)->first();
        if ($payout !== null && $payout->finalized_at !== null) {
            return;
        }

        $this->onSessionUnattended($session);
        $this->onSessionAttended($session);
    }

    /**
     * What an ATTENDED session's payout line is worth: the lesson's price under the teacher's pay
     * type, or 0 for a free trial — a trial is unpaid demo time for the academy AND the teacher
     * (decision). The line is still recorded at zero so the delivered session shows on the
     * statement; the same goes for every lesson of a fixed-salary teacher.
     */
    private function linePayMinor(object $teacher, object $session): int
    {
        if ($this->isFreeTrial((string) $session->id)) {
            return 0;
        }

        $durationMinutes = $session->duration_minutes ?? null;
        $studentId = $session->student_id ?? null;
        if ($durationMinutes === null || $studentId === null) {
            $row = DB::table('sessions')->where('id', $session->id)->first(['duration_minutes', 'student_id']);
            $durationMinutes ??= $row?->duration_minutes;
            $studentId ??= $row?->student_id;
        }

        return $this->lessonPayMinor(
            $teacher,
            $studentId !== null ? (string) $studentId : null,
            (int) ($durationMinutes ?? 0),
        );
    }

    /** Set an open statement's fixed salary to `$base`, moving the net by the difference. */
    private function moveBase(object $payout, int $base, ?string $actorUserId, string $actorRole): void
    {
        $delta = $base - (int) $payout->base_minor;
        if ($delta === 0) {
            return;
        }

        DB::table('payouts')
            ->where('id', $payout->id)
            ->update([
                'base_minor' => DB::raw("base_minor + {$delta}"),
                'total_minor' => DB::raw("total_minor + {$delta}"),
                'updated_at' => now(),
            ]);

        Audit::log(
            'payout.base_synced',
            'payout',
            (string) $payout->id,
            (string) $payout->academy_id,
            $actorUserId,
            $actorRole,
            after: ['base_minor' => $base],
            before: ['base_minor' => (int) $payout->base_minor],
        );

        // A MONTHLY quality report docks a % of the gross, and the salary is part of it.
        $this->quality()->syncPayout((string) $payout->id);
    }

    /**
     * The academy-local month it is right now — the period a fixed salary is being earned in.
     *
     * @return array{0: int, 1: int} [year, month]
     */
    private function currentPeriod(object $academy): array
    {
        $local = now()->setTimezone($academy->timezone ?: 'UTC');

        return [(int) $local->year, (int) $local->month];
    }

    /**
     * Whether the session's report flags it as a free trial (reserved JSONB key written by the
     * report endpoint). A trial pays the teacher nothing — it mirrors the same zeroing the
     * student invoice applies, so the lesson is free for the teacher and the academy alike.
     */
    private function isFreeTrial(string $sessionId): bool
    {
        $values = DB::table('session_reports')->where('session_id', $sessionId)->value('values');
        if ($values === null) {
            return false;
        }

        $decoded = is_string($values) ? json_decode($values, true) : (array) $values;

        return (bool) ($decoded['is_free_trial'] ?? false);
    }

    /**
     * Find or open the OPEN monthly payout for the given teacher/period (one per teacher per
     * period — unique(academy_id, teacher_id, period_year, period_month), Sprint 1).
     *
     * A new statement is born carrying the teacher's fixed salary (0 for anyone paid by the
     * lesson), so the net already includes it and finalize's integrity sum holds from row one.
     *
     * @return string the payout UUID
     */
    private function ensureOpenPayout(object $academy, object $teacher, int $year, int $month): string
    {
        $existing = DB::table('payouts')
            ->where('academy_id', $academy->id)
            ->where('teacher_id', $teacher->id)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->first();

        if ($existing !== null) {
            return (string) $existing->id;
        }

        $id   = (string) Str::uuid();
        $base = self::baseSalaryMinor($teacher);

        DB::table('payouts')->insert([
            'id'           => $id,
            'academy_id'   => $academy->id,
            'teacher_id'   => $teacher->id,
            'period_year'  => $year,
            'period_month' => $month,
            'base_minor'   => $base,
            'total_minor'  => $base,
            'currency'     => (string) $teacher->currency,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        return $id;
    }
}
