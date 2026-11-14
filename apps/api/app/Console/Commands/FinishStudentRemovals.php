<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\ChargeCancellation;
use App\Services\StudentWindDown;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Students removed before the removal wound everything down, finished off the way removing one
 * does today ({@see StudentWindDown}). Academies kept finding a deleted student in الحصص المعلقة:
 * a student deleted before 2026-10-06 kept a live timetable, and until 9c4c32a (2026-11-06) the
 * nightly roll went on generating their lessons — created after the 10-19 backfill hid the old ones,
 * so never hidden. Also: timetables still active, subscriptions / teacher links still open, group
 * seats still taken, trials still booked.
 *
 * Open lesson packages and centre blocks are listed but only closed with `--blocks`: closing one
 * bills the hours it used (ON_COMPLETION), which months later is a money decision, not a cleanup.
 *
 * Lists what it would do; `--apply` does it.
 *
 *   php artisan students:finish-removal [--academy=<uuid>] [--apply] [--blocks]
 */
final class FinishStudentRemovals extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'students:finish-removal
        {--academy= : Limit to one academy id}
        {--apply : Wind them down (default: only list)}
        {--blocks : Also close their open lesson packages / centre blocks (bills the hours used)}';

    protected $description = 'Wind down what removed students still have running (lessons, timetables, trials, group seats).';

    public function handle(StudentWindDown $windDown, ChargeCancellation $charges): int
    {
        $apply = (bool) $this->option('apply');
        $blocks = (bool) $this->option('blocks');
        $total = 0;

        foreach ($this->academies() as $academyId => $name) {
            $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);
            $rows = Tenancy::withContext($ctx, fn () => $this->leftovers());
            if ($rows->isEmpty()) {
                continue;
            }

            $this->info("{$name} ({$academyId}) — {$rows->count()} removed students");
            foreach ($rows as $r) {
                $this->line(sprintf(
                    '  %s (removed %s): %d unmarked · %d still visible · %d timetables · %d subs · %d teachers · %d group seats · %d trials · %d open packages · %d centre blocks',
                    $r->full_name, Carbon::parse($r->deleted_at)->toDateString(),
                    $r->scheduled, $r->visible, $r->timetables, $r->subscriptions, $r->assignments,
                    $r->seats, $r->trials, $r->packages, $r->blocks,
                ));
            }
            $total += $rows->count();

            if (! $apply) {
                continue;
            }

            foreach ($rows as $r) {
                Tenancy::withContext($ctx, function () use ($r, $academyId, $windDown, $charges, $blocks): void {
                    $wound = $windDown->run((string) $r->id, Carbon::now(), null, 'SUPER_ADMIN', closeBlocks: $blocks);
                    // A closed block bills what it used; the delete lets that go with the rest (a centre on receipts).
                    $letGo = $blocks
                        ? $charges->letGoAllOf($academyId, [(string) $r->id], null, StudentWindDown::REASON.' / حذف الطالب', null, 'SUPER_ADMIN')
                        : 0;
                    Audit::log('student.removal_finished', 'student', (string) $r->id, $academyId, null, 'SUPER_ADMIN',
                        after: $wound + ['dues_let_go' => $letGo]);
                });
            }
            $this->info('  → wound down');
        }

        $this->info($total === 0
            ? 'Nothing left running for any removed student.'
            : ($apply ? "Done: {$total} removed students wound down." : "Listed {$total} — run again with --apply to wind them down."));

        return self::SUCCESS;
    }

    /** Removed students with anything still running, and what. */
    private function leftovers(): Collection
    {
        return DB::table('students as s')
            ->whereNotNull('s.deleted_at')
            ->select(['s.id', 's.full_name', 's.deleted_at'])
            ->selectRaw("(select count(*) from sessions se where se.student_id = s.id and se.status = 'SCHEDULED') as scheduled")
            ->selectRaw('(select count(*) from sessions se where se.student_id = s.id and se.hidden_at is null) as visible')
            ->selectRaw('(select count(*) from schedules sc where sc.student_id = s.id and (sc.is_active or sc.deleted_at is null)) as timetables')
            ->selectRaw("(select count(*) from subscriptions su where su.student_id = s.id and su.status = 'ACTIVE' and su.deleted_at is null) as subscriptions")
            ->selectRaw('(select count(*) from student_teacher_assignments a where a.student_id = s.id and a.ended_at is null) as assignments')
            ->selectRaw("(select count(*) from class_group_members m where m.student_id = s.id and m.status = 'ACTIVE') as seats")
            ->selectRaw("(select count(*) from trials t where t.student_id = s.id and t.status = 'SCHEDULED' and t.deleted_at is null) as trials")
            ->selectRaw("(select count(*) from lesson_packages p where p.student_id = s.id and p.status = 'ACTIVE') as packages")
            ->selectRaw("(select count(*) from centre_subscriptions c where c.student_id = s.id and c.status = 'OPEN') as blocks")
            ->orderBy('s.deleted_at')
            ->get()
            ->filter(fn ($r) => (int) $r->scheduled + (int) $r->visible + (int) $r->timetables + (int) $r->subscriptions
                + (int) $r->assignments + (int) $r->seats + (int) $r->trials + (int) $r->packages + (int) $r->blocks > 0)
            ->values();
    }

    /** @return array<string, string> id => name */
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
