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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Opens this month's statement for every fixed-salary teacher who has none yet.
 *
 * A teacher paid by the lesson gets a statement the moment their first lesson is marked attended.
 * A salaried teacher is owed their pay whether or not they taught, so without this a month with no
 * attended lesson would have no statement to carry the salary — and the monthly close on the 3rd
 * would have nothing to finalize. Daily rather than on the 1st so one missed run heals itself the
 * next morning (the same reasoning as RollSessionWindowJob). Idempotent: an existing statement is
 * left alone. Each academy runs in its own tenant context.
 *
 * Scheduled in routes/console.php.
 */
final class OpenFixedSalaryPayoutsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /** Sentinel UUID used as the actor when no human is involved. */
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /** @return array<string, int> academyId => statements opened */
    public function handle(Payroll $payroll): array
    {
        $results = [];

        foreach ($this->targetAcademyIds() as $academyId) {
            try {
                $ctx = new AuthContext(
                    userId: self::SYSTEM_USER_ID,
                    academyId: $academyId,
                    role: 'SUPER_ADMIN',
                    permissions: [],
                );

                $results[$academyId] = Tenancy::withContext(
                    $ctx,
                    fn (): int => $payroll->openFixedSalaryPayouts($academyId),
                );
            } catch (Throwable $e) {
                Log::error('OpenFixedSalaryPayoutsJob: failed for academy', [
                    'academy_id' => $academyId,
                    'error' => $e->getMessage(),
                ]);
                // One academy's failure must not stop the others.
            }
        }

        return $results;
    }

    /**
     * Listing all academies needs a Super-Admin context; set it for the read only, then clear it
     * before each per-academy transaction (the CloseMonthlyPayoutsJob discipline).
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
