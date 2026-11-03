<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\LessonPackages;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Puts a curriculum centre's running blocks on "a lesson is one lesson" (Ahmed, 2026-11-03,
 * {@see LessonPackages::countsLessons()}). Lessons marked before the rule counted by their minutes,
 * so a card could read 3 used with 2 taken. Finished blocks are history and stay as they are. A block
 * this would use up is listed and left, for a person to look at: closing one opens or holds a renewal.
 *
 * `--length=<package id>:<minutes>` corrects a block whose lesson length was entered wrong, open or
 * finished: same minutes and same money, a different count (Malika: 4 × 60 was really 6 × 40). Its bill
 * line follows when the bill is still open.
 *
 * Lists what it would do; `--apply` does it.
 *
 *   php artisan packages:count-by-lesson [--academy=<uuid>] [--length=<id>:<minutes>] [--apply]
 */
final class CountBlocksByLesson extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'packages:count-by-lesson
        {--academy= : Limit to one academy id}
        {--length= : Correct one block\'s lesson length, as <package id>:<minutes>}
        {--apply : Make the changes (default: only list)}';

    protected $description = 'Count a centre\'s running blocks by the lesson, and correct a block\'s lesson length.';

    public function handle(LessonPackages $packages): int
    {
        $apply = (bool) $this->option('apply');
        foreach ($this->academies() as $academyId => $name) {
            $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);
            Tenancy::withContext($ctx, function () use ($academyId, $name, $apply, $packages): void {
                // Asked inside the tenant context: the academy's modules are behind RLS.
                if (! Entitlement::hasCapability($academyId, 'centre')) {
                    return;
                }
                if ((string) $this->option('length') !== '') {
                    $this->correctLength($academyId, $apply, $packages);
                }
                $this->recount($academyId, $name, $apply, $packages);
            });
        }
        $this->info($apply ? 'Done.' : 'Listed only — run again with --apply to make the changes.');

        return self::SUCCESS;
    }

    private function recount(string $academyId, string $name, bool $apply, LessonPackages $packages): void
    {
        $blocks = DB::table('lesson_packages as p')
            ->join('students as s', 's.id', '=', 'p.student_id')
            ->where('p.academy_id', $academyId)
            ->where('p.status', 'ACTIVE')
            ->whereNotNull('p.lesson_minutes')
            ->orderBy('s.full_name')
            ->get(['p.*', 's.full_name as student_name']);

        $printed = false;
        foreach ($blocks as $block) {
            $length = (int) $block->lesson_minutes;
            $lessons = DB::table('lesson_package_credits')->where('package_id', $block->id)->count();
            $consumed = $lessons * $length + (int) $block->absorbed_overdraft_minutes;
            $sold = (int) $block->minutes_total + (int) $block->carried_over_minutes;
            if ($consumed === (int) $block->minutes_consumed) {
                continue;
            }
            if (! $printed) {
                $this->info("{$name} ({$academyId})");
                $printed = true;
            }
            $line = sprintf('  %s · %s · %d lessons of %d min: used %d → %d of %d', $block->student_name, $block->label, $lessons, $length, $block->minutes_consumed, $consumed, $sold);
            if ($consumed >= $sold || (int) $block->minutes_overdrawn > 0) {
                $this->warn($line.'  LEFT: this would use it up, or it has an overdraft');

                continue;
            }
            $this->line($line);
            if ($apply) {
                $packages->recountLessons((string) $block->id, $length);
                Audit::log('lesson_package.recounted_by_lesson', 'lesson_package', (string) $block->id, $academyId, null, 'SUPER_ADMIN',
                    after: ['minutes_consumed' => $consumed], before: ['minutes_consumed' => (int) $block->minutes_consumed]);
            }
        }
    }

    private function correctLength(string $academyId, bool $apply, LessonPackages $packages): void
    {
        [$packageId, $minutes] = array_pad(explode(':', (string) $this->option('length'), 2), 2, '');
        $minutes = (int) $minutes;
        $block = DB::table('lesson_packages')->where('id', $packageId)->where('academy_id', $academyId)->first();
        if ($block === null) {
            return;
        }
        $total = (int) $block->minutes_total;
        $carried = (int) $block->carried_over_minutes;
        if ($minutes <= 0 || $total % $minutes !== 0) {
            $this->error("{$packageId}: {$total} minutes do not divide into lessons of {$minutes}.");

            return;
        }

        $was = $block->lesson_minutes !== null ? (int) $block->lesson_minutes : null;
        $this->line(sprintf('  %s: lesson %s → %d min, %d lessons', $block->label, $was ?? 'none', $minutes, $total / $minutes));
        if (! $apply) {
            return;
        }

        DB::table('lesson_packages')->where('id', $packageId)->update(['lesson_minutes' => $minutes, 'updated_at' => now()]);
        if ($block->invoice_id !== null && DB::table('invoices')->where('id', $block->invoice_id)->value('status') === 'OPEN') {
            $lines = DB::table('invoice_line_items')
                ->where('invoice_id', $block->invoice_id)
                ->whereNull('session_id')
                ->whereIn('description', $packages->packageLineDescriptions((string) $block->label, $total, $carried, $was))
                ->update(['description' => $packages->packageLineDescription((string) $block->label, $total, $carried, $minutes)]);
            $this->line("  bill lines reworded: {$lines}");
        }
        Audit::log('lesson_package.length_corrected', 'lesson_package', $packageId, $academyId, null, 'SUPER_ADMIN',
            after: ['lesson_minutes' => $minutes], before: ['lesson_minutes' => $was]);
    }

    /** @return array<string, string> */
    private function academies(): array
    {
        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->when($this->option('academy'), fn ($q, $id) => $q->where('id', $id))
                ->where('status', 'ACTIVE')
                ->orderBy('name')
                ->pluck('name', 'id')
                ->mapWithKeys(fn ($n, $id) => [(string) $id => (string) $n])
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
