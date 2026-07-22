<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Payroll;
use App\Services\TeacherQuality;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * The hourly "you never marked the lesson" sweep (Discounts & Awards page). For every academy that
 * turned the policy ON, find sessions that ended at least `auto_deduct_grace_hours` ago and still
 * carry no report, and dock the teacher's pay for each — a DEDUCTION on their statement carrying
 * the system's reason, visible to the teacher on their own dashboard.
 *
 * The predicate is deliberately the SAME one FlagOverdueReportsJob uses (no `session_reports` row,
 * status still owing a report, ended past the grace window). That is what makes the policy fair and
 * explainable: the academy already warns the owner about exactly these sessions, so the money
 * follows the warning the system was already giving rather than inventing a second, subtly
 * different notion of "unmarked".
 *
 * Idempotency: a partial unique index (`payout_adjustments (session_id) where source =
 * 'AUTO_UNREPORTED'`) means one deduction per session, forever — `insertOrIgnore` turns any re-run
 * into a no-op, exactly as the overdue sweep dedupes on `notifications (session_id, type)`. So a
 * missed or duplicated run is harmless, and a teacher can never be docked twice for one lesson.
 *
 * Mirrors FlagOverdueReportsJob's tenancy discipline: each academy's work runs in its OWN
 * Tenancy::withContext transaction, and one academy failing must not abort the batch.
 */
final class AutoDeductUnreportedSessionsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /**
     * Don't reach back further than this. A backstop so switching the policy ON never retroactively
     * bills a teacher for months of history in one sweep — the policy starts applying roughly from
     * the day it is enabled, not from the beginning of time.
     */
    private const LOOKBACK_DAYS = 3;

    /** Statuses that still owe a report — identical to the overdue-report sweep. */
    private const NEEDS_REPORT = ['SCHEDULED', 'ATTENDED', 'FREE'];

    /** The canonical audit reason; the UI localizes its own copy off `source`. */
    private const REASON = 'Session not marked within the grace period';

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /**
     * @return array<string, int> academyId → number of sessions newly docked
     */
    public function handle(): array
    {
        $results = [];

        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(
                userId: self::SYSTEM_USER_ID,
                academyId: $academyId,
                role: 'SUPER_ADMIN', // tenant policies key on academy_id; this scopes the writes
                permissions: [],
            );

            try {
                $results[$academyId] = Tenancy::withContext($ctx, function () use ($academyId): int {
                    return $this->deductForAcademy($academyId);
                });
            } catch (Throwable $e) {
                // One academy's failure must not abort the batch (CloseMonthlyPayoutsJob's rule).
                Log::error('auto-deduct-unreported: academy failed', [
                    'academy_id' => $academyId,
                    'error'      => $e->getMessage(),
                ]);
                $results[$academyId] = 0;
            }
        }

        return $results;
    }

    private function deductForAcademy(string $academyId): int
    {
        $settings = DB::table('teacher_quality_settings')
            ->where('academy_id', $academyId)
            ->first();

        if ($settings === null || ! $settings->auto_deduct_enabled) {
            return 0;
        }

        $graceHours = (int) $settings->auto_deduct_grace_hours;
        $basis      = (string) $settings->auto_deduct_basis;
        $flatMinor  = (int) $settings->auto_deduct_amount_minor;
        $bp         = (int) $settings->auto_deduct_bp;

        // Nothing configured to dock — the policy is on but toothless; don't write 0-value rows.
        if ($basis === 'FIXED' && $flatMinor <= 0) {
            return 0;
        }
        if ($basis === 'PERCENT_SESSION' && $bp <= 0) {
            return 0;
        }

        $cutoffEnd = now()->subHours($graceHours);
        $lookback  = now()->subDays(self::LOOKBACK_DAYS);
        $timezone  = DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC';

        $unmarked = DB::table('sessions as se')
            ->leftJoin('session_reports as sr', 'sr.session_id', '=', 'se.id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->whereNull('sr.id')
            ->whereIn('se.status', self::NEEDS_REPORT)
            ->whereNotNull('se.teacher_id')
            ->whereRaw('se.scheduled_at_utc + make_interval(mins => se.duration_minutes) <= ?', [$cutoffEnd->format('Y-m-d H:i:sP')])
            ->where('se.scheduled_at_utc', '>=', $lookback->format('Y-m-d H:i:sP'))
            // Already docked — cheap pre-filter; the unique index is the real guarantee.
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('payout_adjustments as pa')
                    ->whereColumn('pa.session_id', 'se.id')
                    ->where('pa.source', 'AUTO_UNREPORTED');
            })
            ->select([
                'se.id', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.teacher_id',
                'te.session_rate_minor', 'te.currency',
            ])
            ->limit(500)
            ->get();

        $payroll = app(Payroll::class);
        $docked  = 0;

        foreach ($unmarked as $session) {
            $local = Carbon::parse($session->scheduled_at_utc)->setTimezone($timezone);

            $payoutId = $payroll->ensureOpenPayoutFor(
                $academyId,
                (string) $session->teacher_id,
                (int) $local->year,
                (int) $local->month,
            );

            if ($payoutId === null) {
                continue; // Unresolvable teacher — nothing to dock.
            }

            // A finalized statement is money already paid; the DB trigger would reject the insert
            // outright. This is a real race — the sweep runs hourly and the month closes on the 3rd,
            // so a session from the last hours of a period can surface after its payout is sealed.
            // The lesson stays unmarked and un-docked rather than the job throwing.
            $payout = DB::table('payouts')->where('id', $payoutId)->first(['id', 'currency', 'finalized_at']);
            if ($payout === null || $payout->finalized_at !== null) {
                continue;
            }

            $amountMinor = $this->amountFor($basis, $flatMinor, $bp, $session);
            if ($amountMinor <= 0) {
                continue;
            }

            // insertOrIgnore + the partial unique index = one deduction per session, forever.
            $inserted = DB::table('payout_adjustments')->insertOrIgnore([
                'id'                => (string) Str::uuid(),
                'academy_id'        => $academyId,
                'payout_id'         => $payoutId,
                'type'              => 'DEDUCTION',
                'source'            => 'AUTO_UNREPORTED',
                'session_id'        => (string) $session->id,
                'quality_report_id' => null,
                'amount_minor'      => $amountMinor,
                'currency'          => (string) $payout->currency,  // statement currency (no FX)
                'reason'            => self::REASON,
                'details'           => sprintf(
                    'Lesson on %s was still unmarked %dh after it ended.',
                    $local->format('Y-m-d H:i'),
                    $graceHours,
                ),
                'created_by'        => null,   // the system, not a human
                'created_at'        => now(),
                'updated_at'        => now(),
            ]);

            if ($inserted) {
                // Move the statement by this known delta rather than restating it from its rows:
                // finalize checks that the net still equals sessions + rewards − deductions, and a
                // recompute would repair the drift that check exists to catch.
                DB::table('payouts')
                    ->where('id', $payoutId)
                    ->update([
                        'deductions_minor' => DB::raw("deductions_minor + {$amountMinor}"),
                        'total_minor'      => DB::raw("total_minor - {$amountMinor}"),
                        'updated_at'       => now(),
                    ]);
                $docked++;
            }
        }

        if ($docked > 0) {
            // Attribute the scheduled sweep to no human (actor null) — `trigger: scheduled`
            // records that it was the system.
            Audit::log('payout.auto_deduct_run', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN', after: [
                'docked'      => $docked,
                'grace_hours' => $graceHours,
                'basis'       => $basis,
                'trigger'     => 'scheduled',
            ]);
        }

        return $docked;
    }

    /**
     * What the unmarked lesson costs the teacher.
     *
     * PERCENT_SESSION prices off the teacher's rate × duration rather than a payout line, because
     * an unmarked session HAS no line — never being marked is the whole reason we're here. So the
     * percent bites into what the lesson would have paid had they done the paperwork, using the
     * same integer basis-point arithmetic the rest of the money path uses (AC-1.10).
     */
    private function amountFor(string $basis, int $flatMinor, int $bp, object $session): int
    {
        if ($basis === 'FIXED') {
            return $flatMinor;
        }

        $hourlyRateMinor = (int) ($session->session_rate_minor ?? 0);
        $durationMinutes = (int) ($session->duration_minutes ?? 0);
        // Mirrors Payroll::onSessionAttended's pro-rating of the hourly rate.
        $wouldHavePaid = (int) round($hourlyRateMinor * $durationMinutes / 60);

        return TeacherQuality::applyBasisPoints($wouldHavePaid, $bp);
    }

    /**
     * The academies to sweep. Listing all academies needs a Super-Admin context; we set it at
     * session scope only for the read, then clear it before each per-academy transaction
     * (identical discipline to FlagOverdueReportsJob).
     *
     * @return list<string>
     */
    private function targetAcademyIds(): array
    {
        if ($this->onlyAcademyId !== null) {
            return [$this->onlyAcademyId];
        }

        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->where('status', 'ACTIVE')
                ->pluck('id')
                ->map(fn ($id) => (string) $id)
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
