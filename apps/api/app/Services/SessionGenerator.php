<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\RecurrenceCalculator;
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
 *   future & untouched  = SCHEDULED, no report, original_session_id null, scheduled_at_utc >= now
 *   - intended not yet present  → INSERT (insertOrIgnore: the unique occurrence index is the
 *                                 concurrency backstop, TC-5.7)
 *   - intended already present & untouched → align time/teacher/duration in place (no-op on a
 *                                 plain re-run, TC-5.5; moves the time on an edit, TC-5.17)
 *   - future & untouched no longer implied → DELETE (slot removed / schedule edited, TC-5.19)
 *   - anything past or "touched" → never read, never written (§4.5, TC-5.9/5.11/5.20)
 *   - occurrences before the FLOOR are never created (TC-5.3)
 *
 * The floor defaults to `now` — the rolling window job and every incidental regeneration must
 * never invent history. The one caller that passes an earlier floor is saving a timetable, where
 * a start date in the past is a deliberate statement: "these lessons happened, put them on the
 * board so we can mark them." Back-filling stays idempotent (the unique occurrence index), and a
 * back-filled row is still SCHEDULED, so nothing is billed until somebody records an outcome.
 */
final class SessionGenerator
{
    /**
     * Generate (and reconcile) sessions for every active schedule in the current academy.
     *
     * @return array{created:int, removed:int}
     */
    public function generateForAcademy(string $academyId, Carbon $windowStart, Carbon $windowEnd, ?Carbon $now = null): array
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
            $r = $this->generateForSchedule((string) $scheduleId, $windowStart, $windowEnd, $now);
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
        if ($schedule->is_active && $schedule->deleted_at === null) {
            $slots = DB::table('schedule_slots')
                ->where('schedule_id', $scheduleId)
                ->orderBy('id')
                ->get(['id', 'weekday', 'start_time_local', 'duration_minutes'])
                ->map(fn ($s) => [
                    'id' => (string) $s->id,
                    'weekday' => (int) $s->weekday,
                    'start_time_local' => (string) $s->start_time_local,
                    'duration_minutes' => (int) $s->duration_minutes,
                ])->all();

            $intended = RecurrenceCalculator::occurrences(
                $slots,
                (string) $schedule->timezone,
                $windowStart->format('Y-m-d'),
                $windowEnd->format('Y-m-d'),
            );
        }

        // Teacher for newly generated / realigned future rows: the student's CURRENTLY active
        // assignment (so a Sprint-4 reassignment + regenerate moves future sessions to the new
        // teacher, TC-5.25), falling back to the schedule's own teacher when none is open.
        $teacherId = $this->currentTeacherFor((string) $schedule->student_id) ?? (string) $schedule->teacher_id;

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
        foreach ($existingFuture as $row) {
            $key = $row->occurrence_local_date.'|'.$row->slot_id;
            if (! isset($intendedByKey[$key])) {
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
                ]);
                $created += $inserted; // 0 if a concurrent run won the unique index (TC-5.7)
                if ($isBackfill) {
                    $existingPerDate[$date] = ($existingPerDate[$date] ?? 0) + $inserted;
                }

                continue;
            }

            // Existing & untouched → realign to the (possibly edited) template; touched → skip.
            if ($this->isUntouched($existing, $nowUtc)) {
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
     * Future, untouched sessions for a schedule (§4.5): SCHEDULED, no report, not a reschedule
     * successor, and not yet started. These are the only rows generation may delete or realign.
     *
     * @return Collection<int,object>
     */
    private function futureUntouched(string $scheduleId, Carbon $nowUtc, Carbon $windowStart, Carbon $windowEnd)
    {
        return DB::table('sessions')
            ->where('schedule_id', $scheduleId)
            ->where('status', 'SCHEDULED')
            ->whereNull('original_session_id')
            ->where('scheduled_at_utc', '>=', $nowUtc)
            // Bound to the window by the occurrence's LOCAL date (every schedule-derived row has
            // one); rows outside the window are reconciled by a later run, never deleted here.
            ->whereBetween('occurrence_local_date', [$windowStart->format('Y-m-d'), $windowEnd->format('Y-m-d')])
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('session_reports as sr')
                    ->whereColumn('sr.session_id', 'sessions.id');
            })
            ->get(['id', 'occurrence_local_date', 'slot_id']);
    }

    /** Is an already-loaded session row still untouched (regenerable)? (§4.5) */
    private function isUntouched(object $row, Carbon $nowUtc): bool
    {
        if ($row->status !== 'SCHEDULED' || $row->original_session_id !== null) {
            return false;
        }
        if (Carbon::parse($row->scheduled_at_utc)->lessThan($nowUtc)) {
            return false;
        }

        return DB::table('session_reports')->where('session_id', $row->id)->doesntExist();
    }

    /** The student's currently active teacher assignment (Sprint 4), or null. */
    private function currentTeacherFor(string $studentId): ?string
    {
        $id = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)
            ->whereNull('ended_at')
            ->value('teacher_id');

        return $id !== null ? (string) $id : null;
    }
}
