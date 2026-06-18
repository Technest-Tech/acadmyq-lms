<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\AcademyBilling;
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
 * Monthly platform-bill generation (Platform↔Academy billing). For every active, non-trial
 * academy subscription whose current period has elapsed, issue the period's bill and roll the
 * window forward. Idempotent (one bill per academy per period via a unique index), per-academy
 * tenant-isolated — mirrors FlagOverdueReportsJob's discipline.
 */
final class GenerateAcademyInvoicesJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /**
     * @return array<string, ?string> academyId → generated/ensured bill id (or null)
     */
    public function handle(AcademyBilling $billing): array
    {
        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(
                userId: self::SYSTEM_USER_ID,
                academyId: $academyId,
                role: 'SUPER_ADMIN',
                permissions: [],
            );

            $results[$academyId] = Tenancy::withContext($ctx, function () use ($academyId, $billing) {
                $billId = $billing->rollAndBill($academyId);
                if ($billId !== null) {
                    Audit::log('academy_invoice.generated', 'academy_invoice', $billId, $academyId, null, 'SUPER_ADMIN', after: ['trigger' => 'scheduled']);
                }

                return $billId;
            });
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
