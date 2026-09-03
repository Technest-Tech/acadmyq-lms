<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\RollSessionWindowJob;
use App\Services\SessionGenerator;
use Illuminate\Console\Command;

/**
 * Manual entry point for the session generator (§6). Runs the same idempotent roll-forward the
 * scheduled job runs; safe to invoke repeatedly. Examples:
 *
 *   php artisan sessions:generate
 *   php artisan sessions:generate --academy=<uuid> --from=2026-06-01 --to=2026-08-31
 *
 * `--floor` is the repair tool. Generation is future-only by default, so it cannot heal a gap
 * that has already gone past: if the generator was broken (or never ran) for a fortnight, the
 * lessons those two weeks should have held stay missing forever, and the academy is left marking
 * attendance against a board with holes in it. A floor says "materialise what the timetable
 * always implied back to this date" — idempotent, and every back-filled row is SCHEDULED, so
 * nothing bills until a human records an outcome:
 *
 *   php artisan sessions:generate --floor=2026-09-01
 */
final class GenerateSessions extends Command
{
    protected $signature = 'sessions:generate
        {--academy= : Limit to a single academy id (default: every ACTIVE academy)}
        {--from= : Window start date Y-m-d (default: start of current month)}
        {--to= : Window end date Y-m-d (default: end of next month)}
        {--floor= : Back-fill lessons from this date Y-m-d (default: now — never invent history)}';

    protected $description = 'Materialise sessions from active schedules for the rolling window (idempotent).';

    public function handle(SessionGenerator $generator): int
    {
        $job = new RollSessionWindowJob(
            from: $this->option('from') ?: null,
            to: $this->option('to') ?: null,
            onlyAcademyId: $this->option('academy') ?: null,
            floor: $this->option('floor') ?: null,
        );

        $results = $job->handle($generator);

        foreach ($results as $academyId => $counts) {
            $this->info(sprintf('%s → created %d, removed %d', $academyId, $counts['created'], $counts['removed']));
        }
        $this->info('Done ('.count($results).' academy/academies).');

        return self::SUCCESS;
    }
}
