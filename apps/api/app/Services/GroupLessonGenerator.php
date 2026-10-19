<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Entitlement;
use App\Support\RecurrenceCalculator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Materialises `class_group_lessons` from a group's weekly slots (docs/groups §Generation) — the
 * group-class twin of {@see SessionGenerator}, holding the same contract:
 *
 *   - IDEMPOTENT: a re-run creates nothing; the unique (group, slot, local date) index is the
 *     concurrency backstop (insertOrIgnore).
 *   - NEVER REWRITES HISTORY: only an UNTOUCHED lesson — SCHEDULED, not moved by hand, no sheet
 *     recorded, not yet started — is realigned to the template or deleted. Anything held, cancelled,
 *     moved or past is never read for change and never written.
 *   - BOUNDED BY THE GROUP: nothing before `start_date`, nothing after `end_date`. An ARCHIVED group
 *     has an empty intended set, so regenerating it deletes its future untouched lessons only.
 *
 * Saving a group whose start date is in the past back-fills the lessons since then (SCHEDULED, so
 * the academy can mark them) — the timetable rule of 2026_09_02_000003_schedule_start_date. The
 * per-date count guard stops an edited slot time from producing a second copy of every lesson
 * already taught (the slot row is replaced, which detaches those lessons from it).
 *
 * Every method runs inside the caller's tenant context; RLS is the backstop on every write.
 */
final class GroupLessonGenerator
{
    /** Does the academy hold the group-classes feature? The nightly roll skips the ones that don't. */
    public static function enabledFor(string $academyId): bool
    {
        return in_array('groups', Entitlement::resolve($academyId)['capabilities'], true);
    }

    /**
     * Reconcile every ACTIVE group of the academy across the window.
     *
     * @return array{created:int, removed:int}
     */
    public function generateForAcademy(string $academyId, Carbon $windowStart, Carbon $windowEnd, ?Carbon $now = null): array
    {
        $created = 0;
        $removed = 0;

        $ids = DB::table('class_groups')
            ->where('academy_id', $academyId)
            ->where('status', 'ACTIVE')
            ->pluck('id');

        foreach ($ids as $id) {
            $r = $this->generateForGroup((string) $id, $windowStart, $windowEnd, $now);
            $created += $r['created'];
            $removed += $r['removed'];
        }

        return ['created' => $created, 'removed' => $removed];
    }

    /**
     * Reconcile one group over the rolling window, widened back to its start date when that date
     * is in the past and `$backfill` is set (a save, never the nightly roll).
     *
     * @return array{created:int, removed:int}
     */
    public function regenerate(string $groupId, bool $backfill = false, ?Carbon $now = null): array
    {
        $now ??= Carbon::now();
        [$windowStart, $windowEnd] = SessionGenerator::defaultWindow($now);

        $group = DB::table('class_groups')->where('id', $groupId)->first(['start_date']);
        if ($backfill && $group !== null) {
            $start = Carbon::parse($group->start_date)->startOfDay();
            if ($start->lessThan($windowStart)) {
                $windowStart = $start;
            }
        }

        return $this->generateForGroup($groupId, $windowStart, $windowEnd, $now, $backfill);
    }

    /**
     * @return array{created:int, removed:int}
     */
    public function generateForGroup(string $groupId, Carbon $windowStart, Carbon $windowEnd, ?Carbon $now = null, bool $backfill = false): array
    {
        $now ??= Carbon::now();
        $nowUtc = $now->copy()->utc();

        $group = DB::table('class_groups')->where('id', $groupId)->first();
        if ($group === null) {
            return ['created' => 0, 'removed' => 0];
        }

        $intended = [];
        if ($group->status === 'ACTIVE') {
            // Clamp the window to the group's own dates, in its local calendar.
            $from = max($windowStart->format('Y-m-d'), Carbon::parse($group->start_date)->format('Y-m-d'));
            $to = $windowEnd->format('Y-m-d');
            if ($group->end_date !== null) {
                $to = min($to, Carbon::parse($group->end_date)->format('Y-m-d'));
            }

            if ($from <= $to) {
                $slots = DB::table('class_group_slots')
                    ->where('group_id', $groupId)
                    ->orderBy('id')
                    ->get(['id', 'weekday', 'start_time_local', 'duration_minutes'])
                    ->map(fn ($s) => [
                        'id' => (string) $s->id,
                        'weekday' => (int) $s->weekday,
                        'start_time_local' => (string) $s->start_time_local,
                        'duration_minutes' => (int) $s->duration_minutes,
                    ])->all();

                $intended = RecurrenceCalculator::occurrences($slots, (string) $group->timezone, $from, $to);
            }
        }

        $intendedByKey = [];
        foreach ($intended as $o) {
            $intendedByKey[$o['occurrence_local_date'].'|'.$o['slot_id']] = $o;
        }

        // Back-fill bookkeeping per local date (see the class doc): how many lessons the timetable
        // intends on each past date, and how many the group already has there.
        $intendedPerDate = [];
        foreach ($intended as $o) {
            if ($o['scheduled_at_utc']->lessThan($nowUtc)) {
                $intendedPerDate[$o['occurrence_local_date']] = ($intendedPerDate[$o['occurrence_local_date']] ?? 0) + 1;
            }
        }
        $existingPerDate = $intendedPerDate === []
            ? []
            : DB::table('class_group_lessons')
                ->where('group_id', $groupId)
                ->whereIn('occurrence_local_date', array_keys($intendedPerDate))
                ->selectRaw('occurrence_local_date, count(*) as c')
                ->groupBy('occurrence_local_date')
                ->pluck('c', 'occurrence_local_date')
                ->map(fn ($c) => (int) $c)
                ->all();

        $created = 0;
        $removed = 0;

        // 1) Future untouched lessons the timetable no longer implies → gone (window-bounded).
        foreach ($this->futureUntouched($groupId, $nowUtc, $windowStart, $windowEnd) as $row) {
            if (! isset($intendedByKey[$row->occurrence_local_date.'|'.$row->slot_id])) {
                DB::table('class_group_lessons')->where('id', $row->id)->delete();
                $removed++;
            }
        }

        // 2) Missing occurrences → inserted; untouched existing ones → realigned in place.
        foreach ($intended as $o) {
            $isPast = $o['scheduled_at_utc']->lessThan($nowUtc);
            if ($isPast && ! $backfill) {
                continue; // the nightly roll never invents history
            }

            $date = $o['occurrence_local_date'];
            $utc = $o['scheduled_at_utc']->format('Y-m-d H:i:sP');

            $existing = DB::table('class_group_lessons')
                ->where('group_id', $groupId)
                ->where('slot_id', $o['slot_id'])
                ->where('occurrence_local_date', $date)
                ->first();

            if ($existing === null) {
                if ($isPast && ($existingPerDate[$date] ?? 0) >= ($intendedPerDate[$date] ?? 0)) {
                    continue; // that day's lessons are already on the board, however they got there
                }

                $inserted = DB::table('class_group_lessons')->insertOrIgnore([
                    'id' => (string) Str::uuid(),
                    'academy_id' => (string) $group->academy_id,
                    'group_id' => $groupId,
                    'teacher_id' => (string) $group->teacher_id,
                    'slot_id' => $o['slot_id'],
                    'occurrence_local_date' => $date,
                    'scheduled_at_utc' => $utc,
                    'duration_minutes' => $o['duration_minutes'],
                    'status' => 'SCHEDULED',
                ]);
                $created += $inserted;
                if ($isPast) {
                    $existingPerDate[$date] = ($existingPerDate[$date] ?? 0) + $inserted;
                }

                continue;
            }

            if ($this->isUntouched($existing, $nowUtc)) {
                DB::table('class_group_lessons')->where('id', $existing->id)->update([
                    'teacher_id' => (string) $group->teacher_id,
                    'scheduled_at_utc' => $utc,
                    'duration_minutes' => $o['duration_minutes'],
                    'updated_at' => now(),
                ]);
            }
        }

        return ['created' => $created, 'removed' => $removed];
    }

    /** @return Collection<int, object> */
    private function futureUntouched(string $groupId, Carbon $nowUtc, Carbon $windowStart, Carbon $windowEnd)
    {
        return DB::table('class_group_lessons')
            ->where('group_id', $groupId)
            ->where('status', 'SCHEDULED')
            ->whereNull('moved_at')
            ->whereNotNull('slot_id')
            ->where('scheduled_at_utc', '>=', $nowUtc->format('Y-m-d H:i:sP'))
            ->whereBetween('occurrence_local_date', [$windowStart->format('Y-m-d'), $windowEnd->format('Y-m-d')])
            ->whereNotExists(function ($q): void {
                $q->select(DB::raw(1))
                    ->from('class_group_attendance as a')
                    ->whereColumn('a.lesson_id', 'class_group_lessons.id');
            })
            ->get(['id', 'occurrence_local_date', 'slot_id']);
    }

    private function isUntouched(object $row, Carbon $nowUtc): bool
    {
        if ($row->status !== 'SCHEDULED' || $row->moved_at !== null) {
            return false;
        }
        if (Carbon::parse($row->scheduled_at_utc)->lessThan($nowUtc)) {
            return false;
        }

        return DB::table('class_group_attendance')->where('lesson_id', $row->id)->doesntExist();
    }
}
