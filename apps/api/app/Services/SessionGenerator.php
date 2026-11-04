<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\RecurrenceCalculator;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Materialises concrete `sessions` rows from active weekly schedules (Sprint 5 §6). The single
 * most important rule of the sprint lives here: generation is **idempotent**, **future-only**,
 * and **non-destructive to history** (§3.3, §3.4, §4.4, §4.5).
 *
 * Every method assumes it is already inside a tenant context (the HTTP request transaction, or
 * a Tenancy::withContext block for the job/command) — it never opens its own context and never
 * crosses an academy boundary; RLS is the backstop on every write.
 *
 * Reconciliation per schedule (the contract the tests pin down):
 *   intended            = RecurrenceCalculator over the window from the schedule's CURRENT slots
 *   future & untouched  = SCHEDULED, nothing recorded against it, original_session_id null,
 *                         scheduled_at_utc >= now
 *   - intended not yet present  → INSERT (insertOrIgnore: the unique occurrence index is the
 *                                 concurrency backstop, TC-5.7)
 *   - intended already present & untouched → align time/teacher/duration in place (no-op on a
 *                                 plain re-run, TC-5.5; moves the time on an edit, TC-5.17)
 *   - future & untouched no longer implied → DELETE (slot removed / schedule edited, TC-5.19)
 *   - anything past or "touched" → never read, never written (§4.5, TC-5.9/5.11/5.20)
 *   - occurrences before the FLOOR are never created (TC-5.3)
 *   - occurrences before the timetable's OWN start date are never intended, on any run
 *
 * The floor defaults to `now` — the rolling window job and every incidental regeneration must
 * never invent history. The one caller that passes an earlier floor is saving a timetable, where
 * a start date in the past is a deliberate statement: "these lessons happened, put them on the
 * board so we can mark them." Back-filling stays idempotent (the unique occurrence index), and a
 * back-filled row is still SCHEDULED, so nothing is billed until somebody records an outcome.
 *
 * A centre's holidays (docs/centre-profile, Phase 2 §3) take dates OUT of the intended set before
 * reconciliation: a closed date is never created, and a lesson already on it is only ever cancelled
 * by {@see HolidayClosures} (a cancelled row is touched, so it is neither deleted nor realigned here).
 * An academy with no holiday rows has every date open — its output is what it always was.
 */
final class SessionGenerator
{
    public function __construct(private readonly Holidays $holidays = new Holidays) {}

    /**
     * Tables whose row means a lesson is a real record, not just a planned one: it stays where it
     * is when the timetable changes. Most of these carry no cascade either, so deleting such a
     * lesson would fail outright and take the whole timetable save down with it.
     */
    private const RECORDS = [
        'session_reports',
        'session_cancellation_requests',
        'session_joins',
        'session_follow_ups',
        'teacher_quality_reports',
        'invoice_line_items',
        'payout_line_items',
        'lesson_package_credits',
        'room_participants',
        'room_recordings',
    ];

    /**
     * Generate (and reconcile) sessions for every active schedule in the current academy.
     *
     * `$floor` is the earliest instant a lesson may be created at, and defaults (in
     * {@see generateForSchedule}) to `now` — the rolling window must never invent history. A
     * caller passes an earlier floor only to repair a gap: lessons the timetable always implied
     * but that were never materialised, because generation was broken or never ran. Back-filling
     * stays idempotent (the per-date guard plus the unique occurrence index), and a back-filled
     * row is SCHEDULED, so nothing is billed until someone records an outcome.
     *
     * @return array{created:int, removed:int}
     */
    public function generateForAcademy(string $academyId, Carbon $windowStart, Carbon $windowEnd, ?Carbon $now = null, ?Carbon $floor = null): array
    {
        $now ??= Carbon::now();
        $created = 0;
        $removed = 0;

        $scheduleIds = DB::table('schedules')
            ->where('academy_id', $academyId)
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->pluck('id');

        foreach ($scheduleIds as $scheduleId) {
            $r = $this->generateForSchedule((string) $scheduleId, $windowStart, $windowEnd, $now, $floor);
            $created += $r['created'];
            $removed += $r['removed'];
        }

        return ['created' => $created, 'removed' => $removed];
    }

    /**
     * Reconcile one schedule's sessions across the window. A deactivated/deleted schedule has an
     * empty intended set, so this doubles as the "remove future untouched sessions" path used by
     * schedule deletion (§5.4 / AC-5.6).
     *
     * @return array{created:int, removed:int}
     */
    public function generateForSchedule(string $scheduleId, Carbon $windowStart, Carbon $windowEnd, ?Carbon $now = null, ?Carbon $floor = null): array
    {
        $now ??= Carbon::now();
        // Nothing is created before this instant. `now` unless a caller deliberately reaches back.
        $floor ??= $now;

        $schedule = DB::table('schedules')->where('id', $scheduleId)->first();
        if ($schedule === null) {
            return ['created' => 0, 'removed' => 0];
        }

        // Active schedule → its current slots define the intended set; inactive/deleted → empty,
        // which deletes the future untouched rows without touching history.
        $intended = [];
        // Each slot's subject, which its lessons keep (a teacher can teach a student two).
        $slotCourses = [];
        if ($schedule->is_active && $schedule->deleted_at === null) {
            $slots = DB::table('schedule_slots')
                ->where('schedule_id', $scheduleId)
                ->orderBy('id')
                ->get(['id', 'weekday', 'start_time_local', 'duration_minutes', 'course'])
                ->each(function ($s) use (&$slotCourses): void {
                    $slotCourses[(string) $s->id] = $s->course;
                })
                ->map(fn ($s) => [
                    'id' => (string) $s->id,
                    'weekday' => (int) $s->weekday,
                    'start_time_local' => (string) $s->start_time_local,
                    'duration_minutes' => (int) $s->duration_minutes,
                ])->all();

            // The timetable implies nothing before it starts. Every run honours this, the nightly
            // roll included: a floor of `now` alone would fill in the weeks before a future start.
            $from = $windowStart->format('Y-m-d');
            if ($schedule->start_date !== null) {
                $from = max($from, Carbon::parse($schedule->start_date)->format('Y-m-d'));
            }

            $intended = RecurrenceCalculator::occurrences(
                $slots,
                (string) $schedule->timezone,
                $from,
                $windowEnd->format('Y-m-d'),
            );
            $intended = array_values(array_filter($intended, fn ($o) => ! $this->holidays->isClosed((string) $schedule->academy_id, $o['occurrence_local_date'])));
        }

        // Teacher for newly generated / realigned future rows: the timetable's OWN teacher. A
        // student may have several teachers, each with their own timetable, so the student's
        // assignment can no longer stand in for it. Replacing a teacher re-points their timetable
        // and regenerates, which is what still moves the future lessons across (TC-5.25).
        $teacherId = (string) $schedule->teacher_id;

        $nowUtc = $now->copy()->utc();
        $floorUtc = $floor->copy()->utc();

        // Index intended by its idempotency key (occurrence_local_date|slot_id).
        $intendedByKey = [];
        foreach ($intended as $o) {
            $intendedByKey[$o['occurrence_local_date'].'|'.$o['slot_id']] = $o;
        }

        // Back-fill bookkeeping, per local date: how many lessons the schedule INTENDS on that
        // date, and how many already exist. The slot-id lookup below is not enough on its own for
        // history, because editing a lesson's time deletes the old slot and detaches (slot_id →
        // null) the past sessions it produced. Matching by slot alone would then miss them and
        // create a second copy of every lesson already taught — the same lesson twice on the
        // attendance page, markable and billable twice. Counting per date catches that while
        // still allowing an academy that genuinely teaches twice on a Monday to get both.
        $intendedPerDate = [];
        foreach ($intended as $o) {
            if ($o['scheduled_at_utc']->lessThan($nowUtc)) {
                $intendedPerDate[$o['occurrence_local_date']] = ($intendedPerDate[$o['occurrence_local_date']] ?? 0) + 1;
            }
        }
        $existingPerDate = $intendedPerDate === []
            ? []
            : DB::table('sessions')
                ->where('schedule_id', $scheduleId)
                ->whereIn('occurrence_local_date', array_keys($intendedPerDate))
                ->selectRaw('occurrence_local_date, count(*) as c')
                ->groupBy('occurrence_local_date')
                ->pluck('c', 'occurrence_local_date')
                ->map(fn ($c) => (int) $c)
                ->all();

        $created = 0;
        $removed = 0;

        // 1) Remove future & untouched rows no longer implied by the (current) schedule —
        //    BOUNDED to this window, so a narrower edit/regeneration never deletes legitimate
        //    sessions in a month the window doesn't cover (they reconcile when the window rolls).
        $existingFuture = $this->futureUntouched($scheduleId, $nowUtc, $windowStart, $windowEnd);
        $untouched = [];
        foreach ($existingFuture as $row) {
            $key = $row->occurrence_local_date.'|'.$row->slot_id;
            if (isset($intendedByKey[$key])) {
                $untouched[(string) $row->id] = true;
            } else {
                DB::table('sessions')->where('id', $row->id)->delete();
                $removed++;
            }
        }

        // 2) Insert missing future occurrences; align existing untouched ones in place.
        foreach ($intended as $o) {
            if ($o['scheduled_at_utc']->lessThan($floorUtc)) {
                continue; // before the timetable starts — never created (TC-5.3)
            }

            $existing = DB::table('sessions')
                ->where('schedule_id', $scheduleId)
                ->where('occurrence_local_date', $o['occurrence_local_date'])
                ->where('slot_id', $o['slot_id'])
                ->first();

            $utc = $o['scheduled_at_utc']->format('Y-m-d H:i:sP');

            if ($existing === null) {
                // A past date whose lessons are already on the board — however they got there —
                // is history, not a gap to fill.
                $date = $o['occurrence_local_date'];
                $isBackfill = $o['scheduled_at_utc']->lessThan($nowUtc);
                if ($isBackfill && ($existingPerDate[$date] ?? 0) >= ($intendedPerDate[$date] ?? 0)) {
                    continue;
                }

                $inserted = DB::table('sessions')->insertOrIgnore([
                    'id' => (string) Str::uuid(),
                    'academy_id' => (string) $schedule->academy_id,
                    'student_id' => (string) $schedule->student_id,
                    'teacher_id' => $teacherId,
                    'schedule_id' => $scheduleId,
                    'slot_id' => $o['slot_id'],
                    'occurrence_local_date' => $o['occurrence_local_date'],
                    'scheduled_at_utc' => $utc,
                    'duration_minutes' => $o['duration_minutes'],
                    'status' => 'SCHEDULED',
                    'course' => $slotCourses[$o['slot_id']] ?? null,
                ]);
                $created += $inserted; // 0 if a concurrent run won the unique index (TC-5.7)
                if ($isBackfill) {
                    $existingPerDate[$date] = ($existingPerDate[$date] ?? 0) + $inserted;
                }

                continue;
            }

            // Existing & untouched → realign to the (possibly edited) template; touched → skip.
            if (isset($untouched[(string) $existing->id])) {
                DB::table('sessions')->where('id', $existing->id)->update([
                    'teacher_id' => $teacherId,
                    'scheduled_at_utc' => $utc,
                    'duration_minutes' => $o['duration_minutes'],
                    'updated_at' => now(),
                ]);
            }
        }

        return ['created' => $created, 'removed' => $removed];
    }

    /** Default rolling window: start of the current month through end of next month (§3.8). */
    public static function defaultWindow(?Carbon $now = null): array
    {
        $now ??= Carbon::now();

        return [
            $now->copy()->startOfMonth(),
            $now->copy()->addMonthNoOverflow()->endOfMonth(),
        ];
    }

    /**
     * Future, untouched sessions for a schedule (§4.5): SCHEDULED, nothing recorded against them,
     * not a reschedule successor, and not yet started. These are the only rows generation may
     * delete or realign.
     *
     * @return Collection<int,object>
     */
    private function futureUntouched(string $scheduleId, Carbon $nowUtc, Carbon $windowStart, Carbon $windowEnd)
    {
        return self::whereNothingRecorded(DB::table('sessions'))
            ->where('schedule_id', $scheduleId)
            ->where('status', 'SCHEDULED')
            ->whereNull('original_session_id')
            ->where('scheduled_at_utc', '>=', $nowUtc->format('Y-m-d H:i:sP'))
            // Bound to the window by the occurrence's LOCAL date (every schedule-derived row has
            // one); rows outside the window are reconciled by a later run, never deleted here.
            ->whereBetween('occurrence_local_date', [$windowStart->format('Y-m-d'), $windowEnd->format('Y-m-d')])
            ->get(['id', 'occurrence_local_date', 'slot_id']);
    }

    /** Narrow a query on `sessions` to lessons with nothing recorded against them. */
    public static function whereNothingRecorded(Builder $query): Builder
    {
        foreach (self::RECORDS as $table) {
            $query->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from($table)
                ->whereColumn($table.'.session_id', 'sessions.id'));
        }

        return $query;
    }
}
