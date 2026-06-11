<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Invoicing;
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
 * Sprint 7 — month-end invoice close.
 *
 * Iterates over every ACTIVE academy and calls Invoicing::closePeriodInvoices for the
 * previous calendar month. The job is designed to run on the 2nd of each month (after the
 * session-window roll on the 1st) but is fully idempotent — re-running it for the same
 * period is safe. Each academy's work runs in its own Tenancy::withContext transaction so
 * a failure in one academy never affects another.
 *
 * Scheduled in routes/console.php via Schedule::job(new CloseMonthlyInvoicesJob)->monthlyOn(2, '01:00').
 */
final class CloseMonthlyInvoicesJob implements ShouldQueue
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
     * Returns a per-academy map of { academyId => invoicesClosed } for introspection/testing.
     *
     * @return array<string, int>
     */
    public function handle(Invoicing $invoicing): array
    {
        $target = $this->targetPeriod();
        $year   = $target['year'];
        $month  = $target['month'];

        Log::info('CloseMonthlyInvoicesJob: starting', [
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

                $closed = Tenancy::withContext($ctx, function () use ($invoicing, $academyId, $year, $month): int {
                    return $invoicing->closePeriodInvoices(
                        academyId: $academyId,
                        year: $year,
                        month: $month,
                        actorUserId: self::SYSTEM_USER_ID,
                        actorRole: 'SUPER_ADMIN',
                    );
                });

                $results[$academyId] = $closed;

                Log::info('CloseMonthlyInvoicesJob: academy closed', [
                    'academy_id' => $academyId,
                    'closed'     => $closed,
                    'year'       => $year,
                    'month'      => $month,
                ]);
            } catch (Throwable $e) {
                Log::error('CloseMonthlyInvoicesJob: failed for academy', [
                    'academy_id' => $academyId,
                    'year'       => $year,
                    'month'      => $month,
                    'error'      => $e->getMessage(),
                    'trace'      => $e->getTraceAsString(),
                ]);

                // Continue to the next academy — one failure must not abort the batch.
            }
        }

        Log::info('CloseMonthlyInvoicesJob: finished', [
            'year'          => $year,
            'month'         => $month,
            'academies'     => count($academyIds),
            'total_closed'  => array_sum($results),
        ]);

        return $results;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /**
     * Resolve the billing period to close.
     *
     * If explicit overrides were injected (useful for back-fills), use them; otherwise
     * default to the calendar month *before* today — i.e. the month that just ended.
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
     * Return the list of academy IDs to process.
     *
     * Listing all academies requires a super-admin session context. We set it at
     * session scope for the read only, then clear it before entering each per-academy
     * transaction (matching the pattern used in RollSessionWindowJob).
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
