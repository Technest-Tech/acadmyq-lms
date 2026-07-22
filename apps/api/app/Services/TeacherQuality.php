<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Teacher quality — turning a rubric verdict into money.
 *
 * The academy writes a rubric (categories → criteria, each criterion carrying the percent docked
 * when the teacher does NOT meet it). Support then judges a teacher against it, either:
 *
 *   • SESSION scope — this one lesson. The percent bites into that session's payout line.
 *   • MONTHLY scope — the whole period. The percent bites into the month's total accrued pay.
 *
 * The report stores a PERCENT, never an amount. Cash is a DERIVED `payout_adjustments` row
 * (source=QUALITY, one per report, enforced by a partial unique index) that {@see syncPayout}
 * recomputes from current truth. That indirection is the whole design, and it is forced by the
 * MONTHLY case: "5% of the total salary at the end of the month" is a number that does not exist
 * yet when the report is written — the month's gross keeps growing with every attended session. So
 * {@see Payroll} calls back into syncPayout whenever a line moves, and once more at finalize, when
 * the gross is final. After that the DB triggers freeze the row: the statement is money paid.
 *
 * A percent of nothing is nothing: while a teacher has no pay accrued the derived row simply does
 * not exist (`amount_minor > 0` is a CHECK), and it appears the moment they earn something.
 */
final class TeacherQuality
{
    public const SCOPES = ['SESSION', 'MONTHLY'];

    /** 100% in basis points. Percentages are integers here — see {@see applyBasisPoints}. */
    public const FULL_BP = 10000;

    /** The canonical audit reason on a derived row; the UI localizes its own label off `source`. */
    private const QUALITY_REASON = 'Quality report';

    public function __construct(private readonly Payroll $payroll) {}

    // -------------------------------------------------------------------------
    // Reports
    // -------------------------------------------------------------------------

    /**
     * Write a quality report and materialize the deduction it costs.
     *
     * @param  list<array{criterion_id: string, met: bool}>  $answers  the checked/unchecked sheet
     * @return string the new report UUID
     *
     * @throws ValidationException if the scope/session pair is incoherent, the session belongs to
     *                             another teacher, the rubric selection is empty/unknown, or the
     *                             target statement is already finalized.
     */
    public function createReport(
        string $academyId,
        string $teacherId,
        string $scope,
        ?string $sessionId,
        ?int $year,
        ?int $month,
        array $answers,
        ?string $note,
        ?string $actorUserId,
        ?string $actorName,
        string $actorRole,
    ): string {
        $scope = strtoupper($scope);

        if (! in_array($scope, self::SCOPES, true)) {
            throw ValidationException::withMessages(['scope' => ['Scope must be SESSION or MONTHLY.']]);
        }

        $teacher = DB::table('teachers')->where('id', $teacherId)->first();
        if ($teacher === null) {
            throw ValidationException::withMessages(['teacher_id' => ['Teacher not found.']]);
        }

        // Resolve the period. A SESSION report inherits it from the lesson's LOCAL date so it lands
        // on the same statement the lesson paid into; a MONTHLY one is told which period it judges.
        if ($scope === 'SESSION') {
            if ($sessionId === null) {
                throw ValidationException::withMessages([
                    'session_id' => ['Pick the session this report judges.'],
                ]);
            }

            $session = DB::table('sessions')->where('id', $sessionId)->first();
            if ($session === null) {
                throw ValidationException::withMessages(['session_id' => ['Session not found.']]);
            }
            if ((string) $session->teacher_id !== $teacherId) {
                throw ValidationException::withMessages([
                    'session_id' => ['That session was not delivered by this teacher.'],
                ]);
            }

            // A lesson is judged once. The partial unique index is the real guarantee, but reaching
            // it raises a raw 23505 the client can only render as "something went wrong" — so say
            // the actual thing here. (The picker also greys out judged lessons; this covers the
            // stale-tab case that slips past it.)
            $already = DB::table('teacher_quality_reports')->where('session_id', $sessionId)->exists();
            if ($already) {
                throw ValidationException::withMessages([
                    'session_id' => [
                        'This lesson already has a quality report. / هذه الحصة لديها تقرير جودة بالفعل.',
                    ],
                ]);
            }

            $tz    = DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC';
            $local = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz);
            $year  = (int) $local->year;
            $month = (int) $local->month;
        } else {
            $sessionId = null;
            if ($year === null || $month === null) {
                throw ValidationException::withMessages(['period' => ['Pick the month this report judges.']]);
            }
        }

        $items   = $this->snapshotAnswers($academyId, $answers);
        $totalBp = $this->sumBreached($items);

        $payoutId = $this->payroll->ensureOpenPayoutFor($academyId, $teacherId, $year, $month);
        if ($payoutId === null) {
            throw ValidationException::withMessages(['teacher_id' => ['Teacher not found.']]);
        }

        $finalizedAt = DB::table('payouts')->where('id', $payoutId)->value('finalized_at');
        if ($finalizedAt !== null) {
            throw ValidationException::withMessages([
                'payout' => [
                    "That month's payout is already finalized, so its pay can no longer change. / كشف راتب هذا الشهر نهائي بالفعل، ولا يمكن تغيير راتبه.",
                ],
            ]);
        }

        $reportId = (string) Str::uuid();

        DB::table('teacher_quality_reports')->insert([
            'id'             => $reportId,
            'academy_id'     => $academyId,
            'teacher_id'     => $teacherId,
            'scope'          => $scope,
            'session_id'     => $sessionId,
            'period_year'    => $year,
            'period_month'   => $month,
            'payout_id'      => $payoutId,
            'total_bp'       => $totalBp,
            'note'           => $note,
            'author_user_id' => $actorUserId,
            'author_name'    => $actorName,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        foreach ($items as $item) {
            DB::table('teacher_quality_report_items')->insert([
                'id'             => (string) Str::uuid(),
                'academy_id'     => $academyId,
                'report_id'      => $reportId,
                'criterion_id'   => $item['criterion_id'],
                'category_name'  => $item['category_name'],
                'criterion_name' => $item['criterion_name'],
                'discount_bp'    => $item['discount_bp'],
                'met'            => $item['met'],
                'created_at'     => now(),
            ]);
        }

        $this->syncPayout($payoutId);

        Audit::log(
            'teacher_quality.report_created',
            'teacher_quality_report',
            $reportId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: [
                'teacher_id' => $teacherId,
                'scope'      => $scope,
                'session_id' => $sessionId,
                'period'     => sprintf('%04d-%02d', $year, $month),
                'total_bp'   => $totalBp,
                'breached'   => count(array_filter($items, static fn (array $i): bool => ! $i['met'])),
            ],
        );

        return $reportId;
    }

    /**
     * Delete a report and, with it, the money it cost — the derived adjustment cascades on the FK,
     * so this only has to restate the totals afterwards. Rejected once the statement is finalized:
     * the deduction has been paid out in the real world and cannot be un-deducted by deleting the
     * paperwork. Idempotent — a missing report is a no-op.
     */
    public function deleteReport(string $reportId, string $academyId, ?string $actorUserId, string $actorRole): void
    {
        $report = DB::table('teacher_quality_reports')
            ->where('id', $reportId)
            ->where('academy_id', $academyId)
            ->first();

        if ($report === null) {
            return;
        }

        $payoutId = $report->payout_id !== null ? (string) $report->payout_id : null;

        if ($payoutId !== null) {
            $finalizedAt = DB::table('payouts')->where('id', $payoutId)->value('finalized_at');
            if ($finalizedAt !== null) {
                throw ValidationException::withMessages([
                    'payout' => [
                        'Cannot delete: this report already affected a finalized payout. / لا يمكن الحذف: هذا التقرير أثّر على كشف راتب نهائي بالفعل.',
                    ],
                ]);
            }
        }

        // Reverse the money BEFORE dropping the report. The adjustment's FK would cascade it away
        // anyway, but a cascade is invisible to the subtotals — the row would vanish and
        // `deductions_minor` would keep counting it. Take it out by hand so the delta is applied,
        // then let the cascade clear the answer sheet.
        if ($payoutId !== null) {
            $adjustment = DB::table('payout_adjustments')
                ->where('quality_report_id', $reportId)
                ->first(['id', 'amount_minor']);

            if ($adjustment !== null) {
                DB::table('payout_adjustments')->where('id', $adjustment->id)->delete();
                $this->applyDeductionDelta($payoutId, -(int) $adjustment->amount_minor);
            }
        }

        DB::table('teacher_quality_reports')->where('id', $reportId)->delete();

        Audit::log(
            'teacher_quality.report_deleted',
            'teacher_quality_report',
            $reportId,
            $academyId,
            $actorUserId,
            $actorRole,
            before: [
                'teacher_id' => (string) $report->teacher_id,
                'scope'      => (string) $report->scope,
                'total_bp'   => (int) $report->total_bp,
            ],
        );
    }

    // -------------------------------------------------------------------------
    // The derived-money refresh
    // -------------------------------------------------------------------------

    /**
     * Re-derive every QUALITY deduction on a statement against current pay, moving the statement's
     * subtotals by whatever each one changed by.
     *
     * Called from {@see Payroll::onSessionAttended}/{@see Payroll::onSessionUnattended} (the gross
     * moved, so a MONTHLY percent is now worth something different), from {@see createReport} (a new
     * verdict), and from {@see Payroll::finalizePayout} (the last moment the gross can move before
     * the money is sealed). No-op on a finalized statement.
     */
    public function syncPayout(string $payoutId): void
    {
        $payout = DB::table('payouts')->where('id', $payoutId)->first();
        if ($payout === null || $payout->finalized_at !== null) {
            return;
        }

        $reports = DB::table('teacher_quality_reports')
            ->where('payout_id', $payoutId)
            ->get(['id', 'academy_id', 'scope', 'session_id', 'total_bp']);

        $gross = $this->payroll->grossMinor($payoutId);

        foreach ($reports as $report) {
            $base = $report->scope === 'MONTHLY'
                ? $gross
                : $this->payroll->sessionLineAmountMinor($payoutId, (string) $report->session_id);

            $amount = self::applyBasisPoints($base, (int) $report->total_bp);

            $this->upsertDerivedDeduction(
                academyId: (string) $report->academy_id,
                payoutId: $payoutId,
                currency: (string) $payout->currency,
                reportId: (string) $report->id,
                sessionId: $report->session_id !== null ? (string) $report->session_id : null,
                amountMinor: $amount,
            );
        }
    }

    /**
     * Park a report's deduction at `$amountMinor`, moving the statement's subtotals by the
     * DIFFERENCE.
     *
     * Restating the totals from the rows would be easier to read and would be wrong: finalize
     * verifies that `total_minor` still equals sessions + rewards − deductions (AC-8.7), and a
     * recompute that runs first turns that check into a tautology — it would quietly repair the
     * very drift the check exists to catch. So this moves the totals by a known delta, exactly as
     * {@see Payroll::addAdjustment} does for a hand-typed row: the invariant is maintained, and a
     * statement that was already inconsistent stays inconsistent and still trips the guard.
     *
     * Zero means "no deduction" and REMOVES the row rather than storing a 0 (the table CHECKs
     * `amount_minor > 0`) — a teacher with nothing accrued owes nothing, and the row reappears by
     * itself once they earn.
     */
    private function upsertDerivedDeduction(
        string $academyId,
        string $payoutId,
        string $currency,
        string $reportId,
        ?string $sessionId,
        int $amountMinor,
    ): void {
        $existing = DB::table('payout_adjustments')
            ->where('quality_report_id', $reportId)
            ->first(['id', 'amount_minor']);

        $old = $existing !== null ? (int) $existing->amount_minor : 0;
        $new = max($amountMinor, 0);

        if ($new === $old) {
            return; // Nothing moved — don't touch the statement.
        }

        if ($new === 0) {
            DB::table('payout_adjustments')->where('id', $existing->id)->delete();
        } elseif ($existing !== null) {
            DB::table('payout_adjustments')
                ->where('id', $existing->id)
                ->update(['amount_minor' => $new, 'updated_at' => now()]);
        } else {
            DB::table('payout_adjustments')->insert([
                'id'                => (string) Str::uuid(),
                'academy_id'        => $academyId,
                'payout_id'         => $payoutId,
                'type'              => 'DEDUCTION',
                'source'            => 'QUALITY',
                'session_id'        => $sessionId,
                'quality_report_id' => $reportId,
                'amount_minor'      => $new,
                'currency'          => $currency,   // inherit the statement's currency (no FX)
                'reason'            => self::QUALITY_REASON,
                'details'           => null,
                'created_by'        => null,        // derived, not typed by a human
                'created_at'        => now(),
                'updated_at'        => now(),
            ]);
        }

        $this->applyDeductionDelta($payoutId, $new - $old);
    }

    /**
     * Move a statement's deduction subtotal and net by `$delta` (signed; a bigger deduction is a
     * smaller net). Split into explicit +/- rather than interpolating a negative so the emitted SQL
     * never reads `deductions_minor + -500`.
     */
    private function applyDeductionDelta(string $payoutId, int $delta): void
    {
        if ($delta === 0) {
            return;
        }

        $abs         = abs($delta);
        $deductionOp = $delta > 0 ? '+' : '-';
        $totalOp     = $delta > 0 ? '-' : '+';

        DB::table('payouts')
            ->where('id', $payoutId)
            ->update([
                'deductions_minor' => DB::raw("deductions_minor {$deductionOp} {$abs}"),
                'total_minor'      => DB::raw("total_minor {$totalOp} {$abs}"),
                'updated_at'       => now(),
            ]);
    }

    // -------------------------------------------------------------------------
    // Rubric helpers
    // -------------------------------------------------------------------------

    /**
     * A percentage OF a money amount, in exact integer arithmetic.
     *
     * The result is cash a teacher is really paid, so it never goes near a float: `$base * $bp`
     * stays well inside a 64-bit int for any realistic pay, and the `+ FULL_BP / 2` before the
     * integer division is a round-half-up that is deterministic on every platform — unlike
     * `round($base * $pct / 100)`, which would inherit binary floating-point's rounding surprises
     * on exactly the values (x.5) money hits most often.
     */
    public static function applyBasisPoints(int $baseMinor, int $bp): int
    {
        if ($baseMinor <= 0 || $bp <= 0) {
            return 0;
        }

        return intdiv($baseMinor * $bp + intdiv(self::FULL_BP, 2), self::FULL_BP);
    }

    /**
     * Freeze the answers against the rubric AS IT IS RIGHT NOW. Names and percents are copied onto
     * the report because the rubric is editable: renaming "Late to class" or re-pricing it from 5%
     * to 20% must never restate a report the teacher has already read and been docked for.
     *
     * @param  list<array{criterion_id: string, met: bool}>  $answers
     * @return list<array{criterion_id: string, category_name: string, criterion_name: string, discount_bp: int, met: bool}>
     */
    private function snapshotAnswers(string $academyId, array $answers): array
    {
        if ($answers === []) {
            throw ValidationException::withMessages([
                'items' => ['Tick the rubric items this report judges.'],
            ]);
        }

        $ids = array_values(array_unique(array_map(
            static fn (array $a): string => (string) $a['criterion_id'],
            $answers,
        )));

        $criteria = DB::table('teacher_quality_criteria as c')
            ->join('teacher_quality_categories as cat', 'cat.id', '=', 'c.category_id')
            ->whereIn('c.id', $ids)
            ->whereNull('c.deleted_at')
            ->get(['c.id', 'c.name', 'c.discount_bp', 'cat.name as category_name'])
            ->keyBy('id');

        $items = [];
        foreach ($answers as $answer) {
            $criterionId = (string) $answer['criterion_id'];
            $criterion   = $criteria->get($criterionId);

            if ($criterion === null) {
                throw ValidationException::withMessages([
                    'items' => ['That rubric item no longer exists — reload the page and try again.'],
                ]);
            }

            $items[] = [
                'criterion_id'   => $criterionId,
                'category_name'  => (string) $criterion->category_name,
                'criterion_name' => (string) $criterion->name,
                'discount_bp'    => (int) $criterion->discount_bp,
                'met'            => (bool) $answer['met'],
            ];
        }

        return $items;
    }

    /**
     * The report's headline percent, in basis points: only the BREACHED items cost anything
     * ("discount if he doesn't do them"). Capped at 100% — a rubric can be written to add past 100,
     * but no verdict may cost a teacher more than the pay it bites into, and the DB CHECK enforces
     * the same ceiling.
     *
     * @param  list<array{discount_bp: int, met: bool}>  $items
     */
    private function sumBreached(array $items): int
    {
        $sum = 0;
        foreach ($items as $item) {
            if (! $item['met']) {
                $sum += $item['discount_bp'];
            }
        }

        return min($sum, self::FULL_BP);
    }
}
