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
 * Daily sweep that expires lapsed free trials (Platform↔Academy billing). For every non-suspended
 * academy it ensures a subscription row exists (lazy backfill) and, when a trial's `trial_end` has
 * passed, pauses the subscription and — per config('billing.trial_expiry_suspends') — suspends the
 * academy so logins are blocked until it converts to a paid plan.
 *
 * Idempotent (AcademyBilling::expireTrial no-ops once a trial is already PAUSED) and tenant-isolated
 * (each academy's work runs in its OWN Tenancy::withContext transaction), mirroring
 * FlagOverdueReportsJob's discipline.
 */
final class ExpireAcademyTrialsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /**
     * @return array<string, array{expired: bool, suspended: bool}>
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
                $billing->ensureSubscription($academyId);
                $outcome = $billing->expireTrial($academyId);

                if ($outcome['expired']) {
                    Audit::log('academy_subscription.trial_expired', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN', after: [
                        'suspended' => $outcome['suspended'],
                        'trigger' => 'scheduled',
                    ]);
                }

                return $outcome;
            });
        }

        return $results;
    }

    /**
     * Academies eligible for a trial check: ACTIVE or TRIAL (never SUSPENDED). Listing needs a
     * Super-Admin context set at session scope for the read, then cleared before the per-academy
     * transactions (identical discipline to FlagOverdueReportsJob).
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
                ->whereIn('status', ['ACTIVE', 'TRIAL'])
                ->pluck('id')
                ->map(fn ($id) => (string) $id)
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
