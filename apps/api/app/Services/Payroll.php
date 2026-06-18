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
 * pays, at the teacher's hourly `session_rate_minor` pro-rated by the session length + currency,
 * snapshotted at attendance time (R-PAY-1/3,
 * decision §2). One payout per teacher per period; totals maintained transactionally; immutable
 * after finalize.
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
        // `teachers.session_rate_minor` is the teacher's HOURLY rate; a session pays that rate
        // pro-rated by its length, so a 30-min session at 50/hr pays 25 (decision: hourly pay).
        $durationMinutes = (int) ($session->duration_minutes
            ?? DB::table('sessions')->where('id', $session->id)->value('duration_minutes')
            ?? 0);
        // A free-trial lesson is free for the academy too: the teacher accrues nothing for it
        // (decision — a trial is unpaid demo time). The line is still recorded at zero so the
        // delivered session is visible on the payout statement.
        $hourlyRateMinor = (int) $teacher->session_rate_minor;
        $amountMinor     = $this->isFreeTrial((string) $session->id)
            ? 0
            : (int) round($hourlyRateMinor * $durationMinutes / 60);
        $currency        = (string) $teacher->currency;

        $payoutId = $this->ensureOpenPayout($academy, (string) $session->teacher_id, $year, $month, $currency);

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

        // Integrity check: net total must equal sessions + rewards − deductions (AC-8.7,
        // extended for adjustments). sessions = sum of per-session line items.
        $lineSum = (int) DB::table('payout_line_items')
            ->where('payout_id', $payoutId)
            ->sum('amount_minor');

        $expected = $lineSum + (int) $payout->rewards_minor - (int) $payout->deductions_minor;

        if ((int) $payout->total_minor !== $expected) {
            throw new \RuntimeException(
                "Payout {$payoutId} integrity failure: total_minor={$payout->total_minor} but "
                . "sessions({$lineSum}) + rewards({$payout->rewards_minor}) − deductions({$payout->deductions_minor}) = {$expected}."
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
     * @return string the payout UUID
     */
    private function ensureOpenPayout(
        object $academy,
        string $teacherId,
        int $year,
        int $month,
        string $currency,
    ): string {
        $existing = DB::table('payouts')
            ->where('academy_id', $academy->id)
            ->where('teacher_id', $teacherId)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->first();

        if ($existing !== null) {
            return (string) $existing->id;
        }

        $id = (string) Str::uuid();

        DB::table('payouts')->insert([
            'id'           => $id,
            'academy_id'   => $academy->id,
            'teacher_id'   => $teacherId,
            'period_year'  => $year,
            'period_month' => $month,
            'total_minor'  => 0,
            'currency'     => $currency,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        return $id;
    }
}
