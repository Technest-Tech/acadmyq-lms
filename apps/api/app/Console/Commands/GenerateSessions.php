<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\RollSessionWindowJob;
use App\Services\SessionGenerator;
use Illuminate\Console\Command;

/**
 * Manual / cron entry point for the session generator (§6). Runs the same idempotent
 * roll-forward the scheduled job runs; safe to invoke repeatedly. Examples:
 *
 *   php artisan sessions:generate
 *   php artisan sessions:generate --academy=<uuid> --from=2026-06-01 --to=2026-08-31
 */
final class GenerateSessions extends Command
{
    protected $signature = 'sessions:generate
        {--academy= : Limit to a single academy id (default: every ACTIVE academy)}
        {--from= : Window start date Y-m-d (default: start of current month)}
        {--to= : Window end date Y-m-d (default: end of next month)}';

    protected $description = 'Materialise sessions from active schedules for the rolling window (idempotent).';

    public function handle(SessionGenerator $generator): int
    {
        $job = new RollSessionWindowJob(
            from: $this->option('from') ?: null,
            to: $this->option('to') ?: null,
            onlyAcademyId: $this->option('academy') ?: null,
        );

        $results = $job->handle($generator);

        foreach ($results as $academyId => $counts) {
            $this->info(sprintf('%s → created %d, removed %d', $academyId, $counts['created'], $counts['removed']));
        }
        $this->info('Done ('.count($results).' academy/academies).');

        return self::SUCCESS;
    }
}
