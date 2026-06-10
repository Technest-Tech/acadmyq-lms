<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\SessionGenerator;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The per-student weekly recurring schedule (the "rule"), and the trigger that materialises it
 * into concrete sessions (§5.1, §5.4). A schedule is one active row per student with a set of
 * per-weekday slots (R-SCH-1). Saving it runs the idempotent generator over the rolling window;
 * editing or deleting it regenerates FUTURE UNTOUCHED sessions only and never rewrites history
 * (R-SCH-3, §4.5). Every mutation is capability-gated and audited.
 */
final class ScheduleController extends Controller
{
    use InteractsWithScheduling;

    private const WEEKDAY_MIN = 0; // Sunday

    private const WEEKDAY_MAX = 6; // Saturday

    public function __construct(private readonly SessionGenerator $generator) {}

    /** GET /api/students/{id}/schedule — the active schedule + its slots (or null). */
    public function show(string $studentId): JsonResponse
    {
        Gate::authorize('schedule.read');
        $this->assertStudentExists($studentId);

        $schedule = $this->activeSchedule($studentId);
        if ($schedule === null) {
            return response()->json(['schedule' => null, 'slots' => []]);
        }

        $slots = DB::table('schedule_slots')
            ->where('schedule_id', $schedule->id)
            ->orderBy('weekday')->orderBy('start_time_local')
            ->get(['id', 'weekday', 'start_time_local', 'duration_minutes']);

        return response()->json(['schedule' => $schedule, 'slots' => $slots]);
    }

    /**
     * PUT /api/students/{id}/schedule — create or replace the student's weekly schedule + slots,
     * then regenerate. Reconciles slot rows by (weekday, start_time) identity so a removed slot's
     * future untouched sessions are cleared while preserved (touched/past) ones keep their data.
     */
    public function put(Request $request, string $studentId): JsonResponse
    {
        Gate::authorize('schedule.manage');

        $academyId = $this->currentAcademyId();
        $this->assertStudentExists($studentId);

        $data = $this->validateSchedule($request);
        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $teacherId = $data['teacher_id'] ?? $this->currentTeacherFor($studentId);
        if ($teacherId === null) {
            throw ValidationException::withMessages([
                'teacher_id' => ['This student has no assigned teacher; pass teacher_id or assign one first.'],
            ]);
        }
        $this->assertActiveTeacher($teacherId);

        $existing = $this->activeSchedule($studentId);
        $creating = $existing === null;

        if ($creating) {
            $scheduleId = (string) Str::uuid();
            DB::table('schedules')->insert([
                'id' => $scheduleId,
                'academy_id' => $academyId,
                'student_id' => $studentId,
                'teacher_id' => $teacherId,
                'timezone' => $timezone,
                'is_active' => true,
                'version' => 1,
            ]);
        } else {
            $scheduleId = (string) $existing->id;
            DB::table('schedules')->where('id', $scheduleId)->update([
                'teacher_id' => $teacherId,
                'timezone' => $timezone,
                'is_active' => true,
                'deleted_at' => null,
                'version' => DB::raw('version + 1'),
                'updated_at' => now(),
            ]);
        }

        $this->reconcileSlots($academyId, $scheduleId, $data['slots']);

        // Materialise over the rolling window (current month → end of next month, §3.8).
        [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
        $counts = $this->generator->generateForSchedule($scheduleId, $windowStart, $windowEnd);

        $action = $creating ? 'schedule.created' : 'schedule.updated';
        Audit::log($action, 'schedule', $scheduleId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'student_id' => $studentId,
            'teacher_id' => $teacherId,
            'timezone' => $timezone,
            'slots' => array_map(fn ($s) => ['weekday' => $s['weekday'], 'start_time_local' => $s['start_time_local'], 'duration_minutes' => $s['duration_minutes']], $data['slots']),
        ]);
        $this->auditGeneratorRun($academyId, $scheduleId, $counts);

        return response()->json(['scheduleId' => $scheduleId, 'generated' => $counts], $creating ? 201 : 200);
    }

    /**
     * DELETE /api/students/{id}/schedule — deactivate the schedule and remove its future
     * untouched sessions; past and touched sessions are preserved (AC-5.6).
     */
    public function destroy(string $studentId): JsonResponse
    {
        Gate::authorize('schedule.manage');

        $academyId = $this->currentAcademyId();
        $schedule = $this->activeSchedule($studentId);
        if ($schedule === null) {
            abort(404, 'No active schedule for this student.');
        }

        DB::table('schedules')->where('id', $schedule->id)->update([
            'is_active' => false,
            'deleted_at' => now(),
            'updated_at' => now(),
        ]);

        // Inactive schedule → empty intended set → generator deletes future untouched only.
        [$windowStart, $windowEnd] = SessionGenerator::defaultWindow();
        $counts = $this->generator->generateForSchedule((string) $schedule->id, $windowStart, $windowEnd);

        Audit::log('schedule.deleted', 'schedule', (string) $schedule->id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['student_id' => $studentId, 'is_active' => true]);
        $this->auditGeneratorRun($academyId, (string) $schedule->id, $counts);

        return response()->json(['ok' => true, 'generated' => $counts]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * Reconcile slot rows to the desired set, keyed by (weekday, start_time). Kept slots reuse
     * their id (so already-generated future sessions stay matched); removed slots have their
     * future untouched sessions deleted and any remaining (past/touched) sessions detached
     * (slot_id → null) before the slot row is dropped, so the FK never blocks history.
     *
     * @param  list<array{weekday:int, start_time_local:string, duration_minutes:int}>  $desired
     */
    private function reconcileSlots(string $academyId, string $scheduleId, array $desired): void
    {
        $current = DB::table('schedule_slots')->where('schedule_id', $scheduleId)->get();
        $key = fn ($weekday, $time) => $weekday.'|'.substr((string) $time, 0, 5);

        $desiredByKey = [];
        foreach ($desired as $slot) {
            $desiredByKey[$key($slot['weekday'], $slot['start_time_local'])] = $slot;
        }
        $currentByKey = [];
        foreach ($current as $slot) {
            $currentByKey[$key($slot->weekday, $slot->start_time_local)] = $slot;
        }

        // Remove slots no longer desired.
        foreach ($currentByKey as $k => $slot) {
            if (isset($desiredByKey[$k])) {
                continue;
            }
            // Detach every session that points at this slot; the generator already removed the
            // future untouched ones in a prior run, but detach unconditionally keeps the FK safe.
            DB::table('sessions')->where('slot_id', $slot->id)
                ->where('status', 'SCHEDULED')
                ->whereNull('original_session_id')
                ->where('scheduled_at_utc', '>=', now())
                ->whereNotExists(function ($q) {
                    $q->select(DB::raw(1))->from('session_reports as sr')->whereColumn('sr.session_id', 'sessions.id');
                })
                ->delete();
            DB::table('sessions')->where('slot_id', $slot->id)->update(['slot_id' => null, 'updated_at' => now()]);
            DB::table('schedule_slots')->where('id', $slot->id)->delete();
        }

        // Insert new slots; update duration on kept ones.
        foreach ($desiredByKey as $k => $slot) {
            if (isset($currentByKey[$k])) {
                if ((int) $currentByKey[$k]->duration_minutes !== (int) $slot['duration_minutes']) {
                    DB::table('schedule_slots')->where('id', $currentByKey[$k]->id)
                        ->update(['duration_minutes' => $slot['duration_minutes'], 'updated_at' => now()]);
                }

                continue;
            }
            DB::table('schedule_slots')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'schedule_id' => $scheduleId,
                'weekday' => $slot['weekday'],
                'start_time_local' => $this->normaliseTime($slot['start_time_local']),
                'duration_minutes' => $slot['duration_minutes'],
            ]);
        }
    }

    private function activeSchedule(string $studentId): ?object
    {
        return DB::table('schedules')
            ->where('student_id', $studentId)
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->first();
    }

    private function currentTeacherFor(string $studentId): ?string
    {
        $id = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)->whereNull('ended_at')->value('teacher_id');

        return $id !== null ? (string) $id : null;
    }

    private function assertStudentExists(string $studentId): void
    {
        if (DB::table('students')->where('id', $studentId)->whereNull('deleted_at')->doesntExist()) {
            abort(404, 'Student not found.');
        }
    }

    private function assertActiveTeacher(string $teacherId): void
    {
        if (DB::table('teachers')->where('id', $teacherId)->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['teacher_id' => ['Unknown or inactive teacher.']]);
        }
    }

    private function auditGeneratorRun(string $academyId, string $scheduleId, array $counts): void
    {
        Audit::log('generator.run', 'schedule', $scheduleId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'created' => $counts['created'],
            'removed' => $counts['removed'],
        ]);
    }

    private function normaliseTime(string $time): string
    {
        return substr_count($time, ':') === 1 ? $time.':00' : $time;
    }

    /** @return array<string,mixed> */
    private function validateSchedule(Request $request): array
    {
        return $request->validate([
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64', 'timezone'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'slots' => ['required', 'array', 'min:1'],
            'slots.*.weekday' => ['required', 'integer', 'between:'.self::WEEKDAY_MIN.','.self::WEEKDAY_MAX],
            'slots.*.start_time_local' => ['required', 'string', 'regex:/^\d{2}:\d{2}(:\d{2})?$/'],
            'slots.*.duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
        ]);
    }
}
