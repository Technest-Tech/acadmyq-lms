<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\PrepaidMonthly;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

/**
 * Daily: for every academy that bills monthly in advance ({@see PrepaidMonthly}), from its issue day
 * to the month's end, bill next month to every monthly student who does not have it yet. Daily, not
 * once on the 27th, so a missed morning heals the next day and a student who joins on the 29th still
 * gets the month. Academies billing "after the lessons" are read and left alone.
 */
final class PrepaidMonthlyBillingJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /** @return array<string, int> academyId → students billed this run */
    public function handle(PrepaidMonthly $prepaid): array
    {
        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);

            try {
                $results[$academyId] = Tenancy::withContext($ctx, function () use ($prepaid, $academyId): int {
                    $period = $prepaid->periodDue($academyId);
                    if ($period === null) {
                        return 0;
                    }

                    $run = $prepaid->issue($academyId, $period);
                    SendPrepaidBillJob::queueFor($academyId, $period, $run['invoices']);

                    if ($run['students'] > 0 || $run['errors'] > 0) {
                        Audit::log('automation.prepaid_billing', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN', after: [
                            'period' => $period, 'students' => $run['students'], 'invoices' => count($run['invoices']), 'errors' => $run['errors'],
                        ]);
                    }

                    return $run['students'];
                });
            } catch (\Throwable $e) {
                report($e); // one academy's failure never stops the others
                $results[$academyId] = 0;
            }
        }

        return $results;
    }

    /** @return list<string> */
    private function targetAcademyIds(): array
    {
        if ($this->onlyAcademyId !== null) {
            return [$this->onlyAcademyId];
        }

        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->whereIn('status', ['ACTIVE', 'TRIAL'])
                ->pluck('id')
                ->map(fn ($id) => (string) $id)
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
