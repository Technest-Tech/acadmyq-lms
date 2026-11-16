<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\LessonPackages;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Turn an academy's running packages sold in hours into packages counted in lessons, once it has
 * `packages_in_lessons` switched on (2026-11-15: Quran academies whose blocks stayed open on a few
 * stray minutes, or closed early on a mistyped length).
 *
 * Each open block gets a lesson length — its "N × M" label, else the student's timetable, else the
 * length most of its lessons ran — and its lessons are counted again as lessons
 * ({@see LessonPackages::lessonReplay()}). One the count finds finished closes, and renews if it
 * renews: a new block and its bill. That is why the list comes first: every block, its length, what
 * it counted, what it counts now, and which ones close. A block with no length to go on is listed
 * and left in hours.
 *
 * Lists by default; `--apply` writes. Writing needs the switch on, or the blocks would show lessons
 * and go on burning minutes.
 *
 * `--student-cancels`: the academy counts a lesson the student cancels as a lesson taken, so the
 * student's uncharged cancellations in each block's time are counted onto it, in date order.
 * `--length-map=45:40`: a length that is a typo for another (Alrayan has no 45-minute lessons); pair
 * it with `lessons:retime`, which fixes the timetables and unmarked lessons.
 *
 *   php artisan packages:count-in-lessons --academy=<uuid> [--student-cancels] [--length-map=45:40] [--apply]
 */
final class CountPackagesInLessons extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'packages:count-in-lessons
        {--academy= : The academy (required)}
        {--student-cancels : Count uncharged student cancellations in each block time as lessons taken}
        {--length-map= : Lengths that are typos for others, e.g. 45:40 (comma-separated)}
        {--apply : Convert them (default: only list)}';

    protected $description = "List, then convert, an academy's running packages from minutes to lessons.";

    public function handle(LessonPackages $packages): int
    {
        $academyId = (string) $this->option('academy');
        if ($academyId === '') {
            $this->error('Pass --academy=<uuid>.');

            return self::FAILURE;
        }

        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);
        $name = $this->academyName($academyId);
        if ($name === null) {
            $this->error('No such academy.');

            return self::FAILURE;
        }

        $apply = (bool) $this->option('apply');
        $cancels = (bool) $this->option('student-cancels');
        $map = [];
        foreach (array_filter(explode(',', (string) $this->option('length-map'))) as $pair) {
            [$a, $b] = array_map('intval', explode(':', $pair) + [1 => 0]);
            if ($a < 5 || $b < 5) {
                $this->error("Bad --length-map pair \"{$pair}\" (use 45:40).");

                return self::FAILURE;
            }
            $map[$a] = $b;
        }
        $on = Tenancy::withContext($ctx, fn () => LessonPackages::lessonsOn($academyId));
        if ($apply && ! $on) {
            $this->error("{$name}: switch \"packages_in_lessons\" on first (Super Admin → the client → Features).");

            return self::FAILURE;
        }

        $rows = Tenancy::withContext($ctx, fn () => DB::table('lesson_packages as p')
            ->join('students as s', 's.id', '=', 'p.student_id')
            ->where('p.status', 'ACTIVE')
            ->whereNull('p.lesson_minutes')
            ->orderBy('s.full_name')
            ->get(['p.*', 's.full_name as student_name']));

        $this->info("{$name} — {$rows->count()} open packages in hours".($on ? '' : ' (switch is OFF: listing only)'));

        $plans = [];
        $closing = 0;
        $noLength = 0;
        foreach ($rows as $p) {
            $length = Tenancy::withContext($ctx, fn () => $packages->detectLessonLength($p));
            $length = $length !== null ? ($map[$length] ?? $length) : null;
            if ($length === null) {
                $noLength++;
                $this->line(sprintf('  %s · %s: no lesson length to go on — stays in hours', $p->student_name, $p->label));

                continue;
            }

            $plan = Tenancy::withContext($ctx, fn () => $packages->lessonReplay($p, $length, $cancels));
            $capacity = (int) $p->minutes_total + (int) $p->carried_over_minutes;
            $outcome = $plan['overdrawn_after'] > 0
                ? sprintf('FINISHES, %d lesson(s) past the end go to the next block', intdiv($plan['overdrawn_after'], $length))
                : ($plan['left_after'] <= 0 ? 'FINISHES' : sprintf('stays open, %d lessons left', max(1, intdiv($plan['left_after'], $length))));
            if ($plan['left_after'] <= 0) {
                $closing++;
            }
            $this->line(sprintf(
                '  %s · %s: lessons of %d min · %d sold%s · %d taken%s%s · was %d/%d min used → %s%s',
                $p->student_name, $p->label, $length, $plan['lessons_sold'],
                $plan['lessons_by_minutes'] !== null ? sprintf(' (the label says so; its minutes would hold %d)', $plan['lessons_by_minutes']) : '',
                $plan['lessons_used'],
                $plan['cancels_counted'] > 0 ? sprintf(' (%d of them student cancellations)', $plan['cancels_counted']) : '',
                $plan['absorbed_after'] !== (int) $p->absorbed_overdraft_minutes ? sprintf(' · %d stray min from the last block dropped', (int) $p->absorbed_overdraft_minutes - $plan['absorbed_after']) : '',
                (int) $p->minutes_consumed, $capacity, $outcome,
                $plan['left_after'] <= 0 && (bool) $p->auto_renew ? ' (renews: new block + bill)' : '',
            ));
            $plans[(string) $p->id] = $length;
        }

        $this->info(sprintf('%d to convert (%d of them finish now), %d left in hours.', count($plans), $closing, $noLength));
        if (! $apply) {
            if ($plans !== []) {
                $this->info('Run again with --apply to convert them.');
            }

            return self::SUCCESS;
        }

        $done = 0;
        foreach ($plans as $packageId => $length) {
            Tenancy::withContext($ctx, function () use ($packages, $packageId, $length, $cancels, &$done): void {
                DB::transaction(function () use ($packages, $packageId, $length, $cancels, &$done): void {
                    if ($packages->convertToLessons($packageId, $length, null, 'SUPER_ADMIN', $cancels) !== null) {
                        $done++;
                    }
                });
            });
        }
        $this->info("Converted {$done} packages to lessons.");

        return self::SUCCESS;
    }

    private function academyName(string $academyId): ?string
    {
        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            $name = DB::table('academies')->where('id', $academyId)->value('name');

            return $name !== null ? (string) $name : null;
        } finally {
            TenantContext::clear();
        }
    }
}
