<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Payroll;
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
use Throwable;

/**
 * Sprint 8 — month-end payout finalize (parallel to {@see CloseMonthlyInvoicesJob}).
 *
 * Iterates over every ACTIVE academy and calls Payroll::finalizePeriodPayouts for the previous
 * calendar month, sealing each teacher's statement immutably. Designed to run on the 3rd of each
 * month — AFTER the session-window roll (1st) and the invoice close (2nd) — but fully idempotent:
 * finalizing an already-finalized payout is a no-op. Each academy's work runs in its own
 * Tenancy::withContext transaction so a failure in one academy never affects another.
 *
 * Scheduled in routes/console.php via Schedule::job(new CloseMonthlyPayoutsJob)->monthlyOn(3, '01:30').
 */
final class CloseMonthlyPayoutsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /** Sentinel UUID used as the actor when no human is involved. */
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /**
     * @param  int|null  $year   Override the target year  (defaults to previous month's year).
     * @param  int|null  $month  Override the target month (defaults to previous month).
     * @param  string|null  $onlyAcademyId  Limit to a single academy (useful for back-fills / debugging).
     */
    public function __construct(
        private readonly ?int $year = null,
        private readonly ?int $month = null,
        private readonly ?string $onlyAcademyId = null,
    ) {}

    /**
     * Execute the job.
     *
     * Returns a per-academy map of { academyId => payoutsFinalized } for introspection/testing.
     *
     * @return array<string, int>
     */
    public function handle(Payroll $payroll): array
    {
        $target = $this->targetPeriod();
        $year   = $target['year'];
        $month  = $target['month'];

        Log::info('CloseMonthlyPayoutsJob: starting', [
            'target_year'  => $year,
            'target_month' => $month,
            'only_academy' => $this->onlyAcademyId,
        ]);

        $academyIds = $this->targetAcademyIds();
        $results    = [];

        foreach ($academyIds as $academyId) {
            try {
                $ctx = new AuthContext(
                    userId: self::SYSTEM_USER_ID,
                    academyId: $academyId,
                    role: 'SUPER_ADMIN',
                    permissions: [],
                );

                $finalized = Tenancy::withContext($ctx, function () use ($payroll, $academyId, $year, $month): int {
                    return $payroll->finalizePeriodPayouts(
                        academyId: $academyId,
                        year: $year,
                        month: $month,
                        actorUserId: self::SYSTEM_USER_ID,
                        actorRole: 'SUPER_ADMIN',
                    );
                });

                $results[$academyId] = $finalized;

                Log::info('CloseMonthlyPayoutsJob: academy finalized', [
                    'academy_id' => $academyId,
                    'finalized'  => $finalized,
                    'year'       => $year,
                    'month'      => $month,
                ]);
            } catch (Throwable $e) {
                Log::error('CloseMonthlyPayoutsJob: failed for academy', [
                    'academy_id' => $academyId,
                    'year'       => $year,
                    'month'      => $month,
                    'error'      => $e->getMessage(),
                    'trace'      => $e->getTraceAsString(),
                ]);

                // Continue to the next academy — one failure must not abort the batch.
            }
        }

        Log::info('CloseMonthlyPayoutsJob: finished', [
            'year'            => $year,
            'month'           => $month,
            'academies'       => count($academyIds),
            'total_finalized' => array_sum($results),
        ]);

        return $results;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /**
     * Resolve the payroll period to finalize. Explicit overrides win (back-fills); otherwise the
     * calendar month *before* today — the month that just ended.
     *
     * @return array{year: int, month: int}
     */
    private function targetPeriod(): array
    {
        if ($this->year !== null && $this->month !== null) {
            return ['year' => $this->year, 'month' => $this->month];
        }

        $previous = Carbon::now()->subMonthNoOverflow();

        return [
            'year'  => (int) $previous->year,
            'month' => (int) $previous->month,
        ];
    }

    /**
     * Return the list of academy IDs to process. Listing all academies requires a super-admin
     * session context; we set it for the read only, then clear it before entering each
     * per-academy transaction (matching CloseMonthlyInvoicesJob).
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
