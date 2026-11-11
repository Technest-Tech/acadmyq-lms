<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\RecurrenceCalculator;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * One package's lessons, exactly (EnglishSpirit, 2026-11-11: "the current package with all its
 * lessons, no more and no less"). A block of 16 lists 16:
 *
 *   - COUNTED  — the lessons already taken off it (its credits), whatever they ended as.
 *   - UNMARKED — on a running block, the lessons since it started that nobody has marked yet. Marked,
 *                they come off this block, so they hold their place on it now.
 *   - UPCOMING — on a running block, the next lessons its balance still pays for. The timetable runs
 *                on past the block's end; the lessons after that belong to no block yet.
 *
 * Whatever the balance pays for that the timetable has not put on a date yet comes back as a count
 * (`unscheduled`). Lessons in the block's time that it never counted (cancelled, holidays, taken off
 * it) come back apart, in `not_counted`, so the list stays the block's own.
 *
 * The upcoming split is the package card's (`upcoming_in_package_count` in LessonPackageController),
 * the same rule read in PHP: a lesson never splits, so each one that starts with balance left is
 * this block's; a block counted in lessons covers whole lessons.
 */
final class PackageLessonLog
{
    public const COUNTED = 'COUNTED';

    public const UNMARKED = 'UNMARKED';

    public const UPCOMING = 'UPCOMING';

    /** How far the timetable is read ahead for a block's undated lessons: 12 quarters = 3 years. */
    private const PLAN_QUARTERS = 12;

    /** Days read off the timetable per step. */
    private const PLAN_STEP_DAYS = 91;

    public function __construct(private readonly Holidays $holidays = new Holidays) {}

    /**
     * @param  object  $package  a lesson_packages row
     * @return array{lessons: list<array<string,mixed>>, not_counted: list<array<string,mixed>>, unscheduled: int}
     */
    public function of(object $package): array
    {
        $timezone = (string) (DB::table('academies')->where('id', $package->academy_id)->value('timezone') ?: 'UTC');
        // The block's first day on the academy's calendar.
        $since = Carbon::parse((string) $package->starts_on, $timezone)->startOfDay()->utc()->format('Y-m-d H:i:sP');

        $counted = $this->sessions()
            ->join('lesson_package_credits as c', 'c.session_id', '=', 'se.id')
            ->where('c.package_id', $package->id)
            ->get();

        $unmarked = collect();
        $covered = collect();
        $unscheduled = 0;
        // The app's clock with its offset (the test clock in tests; never a naive timestamp).
        $now = now()->utc()->format('Y-m-d H:i:sP');
        if ((string) $package->status === 'ACTIVE') {
            $unmarked = $this->uncounted($package)
                ->where('se.status', 'SCHEDULED')
                ->where('se.scheduled_at_utc', '<', $now)
                ->where('se.scheduled_at_utc', '>=', $since)
                ->get();
            $upcoming = $this->uncounted($package)
                ->where('se.status', 'SCHEDULED')
                ->where('se.scheduled_at_utc', '>=', $now)
                ->get();
            [$covered, $unscheduled] = $this->covered($package, $unmarked, $upcoming, $counted);

            // The timetable is only put on the calendar to the end of next month, so a long block
            // (38 lessons) ran out of dated lessons and showed 20 "no date yet". Its remaining
            // lessons are read off the timetable itself, a quarter at a time until the balance is
            // spent; only what no timetable dates stays a count.
            $plan = collect();
            $planned = null;
            for ($quarter = 0; $unscheduled > 0 && $quarter < self::PLAN_QUARTERS; $quarter++) {
                $plan = $plan->concat($this->planned($package, $timezone, $planned, $now));
                if ($planned === []) {
                    break; // no running timetable to read dates from
                }
                $all = $upcoming->concat($plan)->sortBy(fn (object $r): string => Carbon::parse($r->scheduled_at_utc)->utc()->format('Y-m-d H:i:s').$r->id)->values();
                [$covered, $unscheduled] = $this->covered($package, $unmarked, $all, $counted);
            }
        }

        // The block's own time: from its first day to the day it closed (still running: today).
        $notCounted = $this->uncounted($package)
            ->whereNotIn('se.status', ['SCHEDULED', 'RESCHEDULED'])
            ->where('se.scheduled_at_utc', '>=', $since);
        if ($package->closed_at !== null) {
            $notCounted->where('se.scheduled_at_utc', '<=', Carbon::parse((string) $package->closed_at)->utc()->format('Y-m-d H:i:sP'));
        } else {
            $notCounted->where('se.scheduled_at_utc', '<', $now);
        }

        $lessons = $counted->map(fn (object $r): array => $this->present($r, self::COUNTED))
            ->concat($unmarked->map(fn (object $r): array => $this->present($r, self::UNMARKED)))
            ->concat($covered->map(fn (object $r): array => $this->present($r, self::UPCOMING)))
            ->sortBy(fn (array $r): string => $r['scheduled_at_utc'].$r['id'])
            ->values()
            ->all();

        return [
            'lessons' => $lessons,
            'not_counted' => $notCounted->get()->map(fn (object $r): array => $this->present($r, null))->values()->all(),
            'unscheduled' => $unscheduled,
        ];
    }

    /**
     * Of the upcoming lessons, the ones the balance still pays for, and how many more lessons it pays
     * for that are not on a date yet. The unmarked lessons are paid first: they come off this block
     * the moment they are marked.
     *
     * @return array{0: Collection<int,object>, 1: int}
     */
    private function covered(object $package, Collection $unmarked, Collection $upcoming, Collection $counted): array
    {
        $remaining = max(0, (int) $package->minutes_total + (int) $package->carried_over_minutes - (int) $package->minutes_consumed);

        if (LessonPackages::countsLessons($package)) {
            $slots = max(0, intdiv($remaining, max(1, (int) $package->lesson_minutes)) - $unmarked->count());
            $covered = $upcoming->take($slots)->values();

            return [$covered, $slots - $covered->count()];
        }

        $budget = $remaining - (int) $unmarked->sum('duration_minutes');
        $before = 0;
        $covered = collect();
        foreach ($upcoming as $lesson) {
            if ($before >= $budget) {
                break;
            }
            $covered->push($lesson);
            $before += (int) $lesson->duration_minutes;
        }

        // What is left after the last lesson on a date, in lessons of the usual length.
        $left = $budget - $before;
        $length = (int) ($package->lesson_minutes
            ?? $upcoming->last()?->duration_minutes
            ?? $unmarked->last()?->duration_minutes
            ?? $counted->last()?->duration_minutes
            ?? 0);

        return [$covered, $left > 0 && $length > 0 ? (int) ceil($left / $length) : 0];
    }

    /**
     * The next stretch of lessons the student's timetables will put on the calendar after the ones
     * already there: every running timetable inside this block's subject, from the day after its
     * last lesson on the calendar, holidays left out, the generator's own rules
     * ({@see SessionGenerator::generateForSchedule}). `$state` carries where each timetable got to,
     * so each call reads the next {@see PLAN_STEP_DAYS} days.
     *
     * @param  array<string, array{from: string, slots: list<array{id:string, weekday:int, start_time_local:string, duration_minutes:int}>, schedule: object}>|null  $state
     * @return Collection<int,object>
     */
    private function planned(object $package, string $academyTimezone, ?array &$state, string $now): Collection
    {
        $state ??= $this->timetables($package, $academyTimezone);

        $out = collect();
        $nowAt = Carbon::parse($now);
        foreach ($state as $key => $entry) {
            $schedule = $entry['schedule'];
            $to = Carbon::parse($entry['from'])->addDays(self::PLAN_STEP_DAYS - 1)->format('Y-m-d');
            foreach (RecurrenceCalculator::occurrences($entry['slots'], (string) $schedule->timezone, $entry['from'], $to) as $o) {
                if ($o['scheduled_at_utc']->lessThan($nowAt)
                    || $this->holidays->isClosed((string) $schedule->academy_id, $o['occurrence_local_date'])) {
                    continue;
                }
                $out->push((object) [
                    'id' => 'plan-'.$schedule->id.'-'.$o['occurrence_local_date'].'-'.$o['slot_id'],
                    'student_id' => (string) $schedule->student_id,
                    'teacher_id' => (string) $schedule->teacher_id,
                    'schedule_id' => (string) $schedule->id,
                    'scheduled_at_utc' => $o['scheduled_at_utc']->copy()->utc()->format('Y-m-d H:i:sP'),
                    'duration_minutes' => (int) $o['duration_minutes'],
                    'status' => 'SCHEDULED',
                    'status_reason' => null,
                    'original_session_id' => null,
                    'student_name' => $schedule->student_name,
                    'teacher_name' => $schedule->teacher_name,
                    'planned' => true,
                ]);
            }
            $state[$key]['from'] = Carbon::parse($to)->addDay()->format('Y-m-d');
        }

        return $out;
    }

    /**
     * The student's running timetables inside this block's subject (a block tied to a teacher and
     * course only takes that teacher's lessons of that course: `uncounted`'s rule, on the slots),
     * each with the first day the calendar does not hold yet.
     *
     * @return array<string, array{from: string, slots: list<array{id:string, weekday:int, start_time_local:string, duration_minutes:int}>, schedule: object}>
     */
    private function timetables(object $package, string $academyTimezone): array
    {
        // A removed student has no more lessons, whatever their timetable still says.
        if (DB::table('students')->where('id', $package->student_id)->whereNotNull('deleted_at')->exists()) {
            return [];
        }

        $schedules = DB::table('schedules as sc')
            ->leftJoin('students as st', 'st.id', '=', 'sc.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'sc.teacher_id')
            ->where('sc.student_id', $package->student_id)
            ->where('sc.is_active', true)
            ->whereNull('sc.deleted_at')
            ->when($package->teacher_id !== null, fn ($q) => $q->where('sc.teacher_id', (string) $package->teacher_id))
            ->orderBy('sc.id')
            ->get(['sc.id', 'sc.academy_id', 'sc.student_id', 'sc.teacher_id', 'sc.timezone', 'sc.start_date', 'st.full_name as student_name', 'te.full_name as teacher_name']);

        $course = mb_strtolower(trim((string) ($package->course ?? '')));
        $today = Carbon::now($academyTimezone)->format('Y-m-d');

        $out = [];
        foreach ($schedules as $schedule) {
            $slots = DB::table('schedule_slots')
                ->where('schedule_id', $schedule->id)
                ->orderBy('id')
                ->get(['id', 'weekday', 'start_time_local', 'duration_minutes', 'course'])
                ->filter(fn (object $s): bool => $package->teacher_id === null
                    || $s->course === null
                    || mb_strtolower(trim((string) $s->course)) === $course)
                ->map(fn (object $s): array => [
                    'id' => (string) $s->id,
                    'weekday' => (int) $s->weekday,
                    'start_time_local' => (string) $s->start_time_local,
                    'duration_minutes' => (int) $s->duration_minutes,
                ])
                ->values()
                ->all();
            if ($slots === []) {
                continue;
            }

            // The day after the last lesson the generator put on the calendar for it; never before
            // the timetable starts, never in the past.
            $last = DB::table('sessions')->where('schedule_id', $schedule->id)->whereNotNull('slot_id')->max('occurrence_local_date');
            $from = max(
                $last !== null ? Carbon::parse((string) $last)->addDay()->format('Y-m-d') : $today,
                $schedule->start_date !== null ? substr((string) $schedule->start_date, 0, 10) : $today,
                $today,
            );

            $out[(string) $schedule->id] = ['from' => $from, 'slots' => $slots, 'schedule' => $schedule];
        }

        return $out;
    }

    /** The calendar's lesson shape, oldest first. */
    private function sessions(): Builder
    {
        return DB::table('sessions as se')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->select([
                'se.id', 'se.student_id', 'se.teacher_id', 'se.schedule_id',
                'se.scheduled_at_utc', 'se.duration_minutes', 'se.status', 'se.status_reason',
                'se.original_session_id',
                'st.full_name as student_name', 'te.full_name as teacher_name',
            ])
            ->orderBy('se.scheduled_at_utc')->orderBy('se.id');
    }

    /**
     * The student's lessons that no block has counted, inside this block's subject: a block tied to
     * a teacher (and course) only ever takes that subject's lessons (LessonPackageController's
     * `lessonOfSubject`, the same rule).
     */
    private function uncounted(object $package): Builder
    {
        $query = $this->sessions()
            ->where('se.student_id', $package->student_id)
            ->whereNull('se.hidden_at')
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('lesson_package_credits as uc')->whereColumn('uc.session_id', 'se.id'));

        if ($package->teacher_id !== null) {
            $query->whereRaw('coalesce((select sc.teacher_id from schedules sc where sc.id = se.schedule_id), se.teacher_id) = ?', [(string) $package->teacher_id])
                ->whereRaw('(se.course is null or lower(trim(se.course)) = lower(trim(?)))', [(string) ($package->course ?? '')]);
        }

        return $query;
    }

    /** @return array<string,mixed> */
    private function present(object $r, ?string $state): array
    {
        return [
            'id' => (string) $r->id,
            'student_id' => (string) $r->student_id,
            'teacher_id' => $r->teacher_id !== null ? (string) $r->teacher_id : null,
            'schedule_id' => $r->schedule_id !== null ? (string) $r->schedule_id : null,
            'scheduled_at_utc' => Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String(),
            'duration_minutes' => (int) $r->duration_minutes,
            'status' => (string) $r->status,
            'status_reason' => $r->status_reason,
            'original_session_id' => $r->original_session_id !== null ? (string) $r->original_session_id : null,
            'student_name' => $r->student_name,
            'teacher_name' => $r->teacher_name,
            'package_state' => $state,
            // Not on the calendar yet: the date the timetable gives it (it lands there as the
            // calendar rolls forward, by the same rules).
            'planned' => (bool) ($r->planned ?? false),
        ];
    }
}
