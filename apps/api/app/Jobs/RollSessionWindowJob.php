<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\SessionGenerator;
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

/**
 * The monthly roll-forward (§6): extend every active academy's session window forward and
 * reconcile. Each academy's work runs in its OWN tenant context (Tenancy::withContext — one
 * transaction, GUCs set transaction-locally, RLS enforced) so a single job never crosses an
 * academy boundary. Idempotent: re-running produces the same rows (the generator's job).
 *
 * Registered on the Laravel scheduler in routes/console.php (Schedule::job(...)). Also runnable
 * on demand via the `sessions:generate` Artisan command.
 */
final class RollSessionWindowJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /** A system actor for audit attribution of the scheduled run (no human user). */
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(
        private readonly ?string $from = null,
        private readonly ?string $to = null,
        private readonly ?string $onlyAcademyId = null,
    ) {}

    /**
     * Run the generator for each target academy and return per-academy counts.
     *
     * @return array<string, array{created:int, removed:int}>
     */
    public function handle(SessionGenerator $generator): array
    {
        [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
        if ($this->from !== null) {
            $windowStart = Carbon::parse($this->from);
        }
        if ($this->to !== null) {
            $windowEnd = Carbon::parse($this->to);
        }

        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(
                userId: self::SYSTEM_USER_ID,
                academyId: $academyId,
                role: 'SUPER_ADMIN', // tenant policies key on academy_id, not role; this just scopes writes
                permissions: [],
            );

            $results[$academyId] = Tenancy::withContext($ctx, function () use ($generator, $academyId, $windowStart, $windowEnd) {
                $counts = $generator->generateForAcademy($academyId, $windowStart, $windowEnd);

                Audit::log('generator.run', 'academy', $academyId, $academyId, self::SYSTEM_USER_ID, 'SUPER_ADMIN', after: [
                    'created' => $counts['created'],
                    'removed' => $counts['removed'],
                    'window' => [$windowStart->format('Y-m-d'), $windowEnd->format('Y-m-d')],
                    'trigger' => 'scheduled',
                ]);

                return $counts;
            });
        }

        return $results;
    }

    /**
     * The academies to roll forward. Listing all academies requires a Super-Admin context (the
     * academies select policy admits is_super_admin()); we set it at session scope only for the
     * read, then clear it before entering each per-academy transaction.
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
