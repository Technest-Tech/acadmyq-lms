<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\GroupBilling;
use App\Services\GroupLessonGenerator;
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
 * Raises this month's up-front charge for every member of every MONTHLY group (docs/groups §Money).
 *
 * Daily, not on the 1st, for the reason the session roll is daily: a missed run heals itself the
 * next morning, and the work is a no-op once a month is billed (the invoice lines' unique group
 * index makes a second charge impossible). Runs after the roll (00:30), so the month's lessons —
 * the unit a late joiner is pro-rated by — already exist. Only for academies that hold both
 * `groups` and `invoicing`; each academy in its own tenant context, and one failure never stops
 * the rest.
 *
 * Scheduled in routes/console.php.
 */
final class BillGroupMonthsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /** @return array<string, int> academyId => charges raised */
    public function handle(GroupBilling $billing): array
    {
        $results = [];

        foreach ($this->targetAcademyIds() as $academyId) {
            try {
                $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);

                $results[$academyId] = Tenancy::withContext($ctx, function () use ($billing, $academyId): int {
                    if (! GroupLessonGenerator::enabledFor($academyId) || ! GroupBilling::enabledFor($academyId)) {
                        return 0;
                    }

                    $added = 0;
                    $groups = DB::table('class_groups')
                        ->where('academy_id', $academyId)
                        ->where('status', 'ACTIVE')
                        ->where('billing_mode', GroupBilling::MONTHLY)
                        ->whereNotNull('price_minor')
                        ->get();

                    foreach ($groups as $group) {
                        $today = Carbon::now((string) $group->timezone);
                        $added += $billing->billMonth($group, (int) $today->year, (int) $today->month);
                    }

                    return $added;
                });
            } catch (Throwable $e) {
                Log::error('BillGroupMonthsJob: failed for academy', ['academy_id' => $academyId, 'error' => $e->getMessage()]);
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
            return DB::table('academies')->where('status', 'ACTIVE')->pluck('id')->map(fn ($id) => (string) $id)->all();
        } finally {
            TenantContext::clear();
        }
    }
}
