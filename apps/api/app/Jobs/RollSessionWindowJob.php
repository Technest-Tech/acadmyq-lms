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
use Illuminate\Support\Facades\Cache;
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

    /** A system actor for audit attribution of the scheduled run (no human user). Audit maps it
     *  to a null actor — it is not a `users` row, and writing it would violate the FK. */
    private const SYSTEM_USER_ID = Audit::SYSTEM_ACTOR_ID;

    public function __construct(
        private readonly ?string $from = null,
        private readonly ?string $to = null,
        private readonly ?string $onlyAcademyId = null,
        /** Earliest date a lesson may be created at; null = `now` (never invent history). */
        private readonly ?string $floor = null,
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

        $floor = $this->floor !== null ? Carbon::parse($this->floor)->startOfDay() : null;
        $now = Carbon::now();

        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(
                userId: self::SYSTEM_USER_ID,
                academyId: $academyId,
                role: 'SUPER_ADMIN', // tenant policies key on academy_id, not role; this just scopes writes
                permissions: [],
            );

            $results[$academyId] = Tenancy::withContext($ctx, function () use ($generator, $academyId, $windowStart, $windowEnd, $floor) {
                $counts = $generator->generateForAcademy($academyId, $windowStart, $windowEnd, null, $floor);

                Audit::log('generator.run', 'academy', $academyId, $academyId, self::SYSTEM_USER_ID, 'SUPER_ADMIN', after: [
                    'created' => $counts['created'],
                    'removed' => $counts['removed'],
                    'window' => [$windowStart->format('Y-m-d'), $windowEnd->format('Y-m-d')],
                    'floor' => $floor?->format('Y-m-d'),
                    'trigger' => 'scheduled',
                ]);

                return $counts;
            });
        }

        // What the roll actually achieved, for GET /api/health. A heartbeat proves the scheduler
        // is alive; this proves the work it exists to do is landing. A horizon that stops
        // shrinking-and-refilling is the early warning nobody had when generation broke.
        Cache::put('scheduler.last_roll_at', $now->toIso8601String(), $now->copy()->addDays(30));
        Cache::put('scheduler.last_roll_created', array_sum(array_column($results, 'created')), $now->copy()->addDays(30));

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
