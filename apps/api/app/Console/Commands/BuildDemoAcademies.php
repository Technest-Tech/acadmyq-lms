<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Demo\DemoAcademies;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Create (or rebuild) the two demo academies a sales lead is given a login to: a one-to-one Quran
 * academy and a learning centre, each with three months of lessons, bills and salaries behind
 * today's date. See {@see DemoAcademies}.
 *
 *   php artisan demo:academies                 # build whichever is missing; leave the others alone
 *   php artisan demo:academies --fresh         # wipe both and build them again around today
 *   php artisan demo:academies --only=centre   # one of them
 *   php artisan demo:academies --fresh --force # on production
 *
 * It only ever touches its own two academies (fixed ids). A plain re-run changes no data: an
 * academy that is already there is left exactly as it is, and only its printed logins are put back
 * on the shared password. Dates are relative to the day it runs, so `--fresh` is what makes an old
 * demo look current again.
 */
final class BuildDemoAcademies extends Command
{
    protected $signature = 'demo:academies
        {--fresh : Delete the demo academies and build them again around today}
        {--force : Allow it on production}
        {--only= : Only one of them: quran or centre}
        {--months=3 : Full months of history behind the current one}';

    protected $description = 'Create or rebuild the two demo academies for sales (a Quran academy and a learning centre).';

    public function handle(DemoAcademies $demo): int
    {
        if ($this->laravel->environment('production') && ! $this->option('force')) {
            $this->error('This is production. Run it again with --force if you mean it — it only touches the two demo academies.');

            return self::FAILURE;
        }

        $only = $this->option('only');
        if ($only !== null && ! in_array($only, DemoAcademies::keys(), true)) {
            $this->error('--only must be one of: '.implode(', ', DemoAcademies::keys()).'.');

            return self::FAILURE;
        }
        $months = (int) $this->option('months');
        if ($months < 1 || $months > 12) {
            $this->error('--months must be between 1 and 12.');

            return self::FAILURE;
        }

        $keys = $only !== null ? [$only] : DemoAcademies::keys();
        $now = CarbonImmutable::now();
        $failed = false;

        foreach ($keys as $key) {
            $about = DemoAcademies::describe($key);
            $this->newLine();
            $this->line("<options=bold>{$about['name']}</> ({$about['subdomain']})");

            $exists = $demo->exists($key);

            if ($exists && ! $this->option('fresh')) {
                $logins = $demo->restoreLogins($key);
                $this->line("  Already there — left as it is ({$logins} logins put back on the demo password). Use --fresh to rebuild it around today.");

                continue;
            }

            if ($exists) {
                $removed = array_sum($demo->purge($key));
                $this->line("  Deleted the old one ({$removed} rows).");
            }

            $conflicts = $demo->conflicts($key);
            if ($conflicts !== []) {
                foreach ($conflicts as $conflict) {
                    $this->error('  '.$conflict);
                }
                $failed = true;

                continue;
            }

            $started = microtime(true);
            $result = $demo->build($key, $now, $months);
            $this->line(sprintf('  Built in %.0f s.', microtime(true) - $started));

            $this->table(['What', 'How many'], array_map(
                fn (string $what, int $count): array => [str_replace('_', ' ', $what), $count],
                array_keys($result['counts']),
                $result['counts'],
            ));
            foreach ($result['warnings'] as $warning) {
                $this->warn('  '.$warning);
            }
        }

        $this->newLine();
        $this->line('<options=bold>Logins</> — password for all of them: <info>'.DemoAcademies::PASSWORD.'</info>');
        $rows = [];
        foreach ($keys as $key) {
            $about = DemoAcademies::describe($key);
            foreach (DemoAcademies::logins($key) as $login) {
                $rows[] = [$about['name'], $about['subdomain'], $login['role'], $login['email']];
            }
        }
        $this->table(['Academy', 'Address', 'Role', 'Email'], $rows);

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
