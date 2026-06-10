<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Per-session operations that act on EXACTLY ONE occurrence without disturbing the series
 * (R-SCH-2, §5.2/5.3): ad-hoc create, reschedule (cancel-origin + linked successor, §3.6),
 * and cancel (non-billable status only — billable ABSENT_* outcomes are Sprint 6, AC-5.12).
 *
 * Conflict & availability checks are soft guidance returned as `warnings`; they never block
 * (§3.7). A TEACHER may only reschedule/cancel sessions they teach (§3.6); ad-hoc creation is
 * `schedule.manage`, which Teachers do not hold.
 */
final class SessionController extends Controller
{
    use InteractsWithScheduling;

    private const NON_BILLABLE_CANCELS = [
        'teacher' => 'CANCELLED_BY_TEACHER',
        'student' => 'CANCELLED_BY_STUDENT',
    ];

    /** POST /api/sessions — a one-off session not tied to any schedule (AC-5.10). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('schedule.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'student_id' => ['required', 'uuid'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'scheduled_at_utc' => ['sometimes', 'nullable', 'date'],
            'local_datetime' => ['sometimes', 'nullable', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
        ]);

        if (DB::table('students')->where('id', $data['student_id'])->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['student_id' => ['Unknown or inactive student.']]);
        }

        $teacherId = $data['teacher_id'] ?? $this->currentTeacherFor($data['student_id']);
        if ($teacherId === null) {
            throw ValidationException::withMessages(['teacher_id' => ['No teacher given and the student has none assigned.']]);
        }
        $this->assertActiveTeacher($teacherId);

        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $startUtc = $this->resolveInstant($data, $timezone);
        $duration = (int) $data['duration_minutes'];

        $sessionId = (string) Str::uuid();
        DB::table('sessions')->insert([
            'id' => $sessionId,
            'academy_id' => $academyId,
            'student_id' => $data['student_id'],
            'teacher_id' => $teacherId,
            'schedule_id' => null, // ad-hoc: never owned by a schedule, never touched by the generator
            'slot_id' => null,
            'occurrence_local_date' => null,
            'scheduled_at_utc' => $startUtc->format('Y-m-d H:i:sP'),
            'duration_minutes' => $duration,
            'status' => 'SCHEDULED',
        ]);

        Audit::log('session.created', 'session', $sessionId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'student_id' => $data['student_id'],
            'teacher_id' => $teacherId,
            'scheduled_at_utc' => $startUtc->toIso8601String(),
            'duration_minutes' => $duration,
            'ad_hoc' => true,
        ]);

        return response()->json([
            'sessionId' => $sessionId,
            'warnings' => $this->schedulingWarnings($teacherId, $startUtc, $duration, $timezone, $sessionId),
        ], 201);
    }

    /**
     * POST /api/sessions/{id}/reschedule — move one occurrence: mark the original RESCHEDULED
     * (non-billable, audit-visible) and create a linked SCHEDULED successor pointing back via
     * original_session_id. Exactly two rows change; the series is untouched (AC-5.3, §3.6).
     */
    public function reschedule(Request $request, string $sessionId): JsonResponse
    {
        Gate::authorize('session.reschedule');

        $academyId = $this->currentAcademyId();
        $session = $this->findOwnedSession($sessionId);

        $data = $request->validate([
            'scheduled_at_utc' => ['sometimes', 'nullable', 'date'],
            'local_datetime' => ['sometimes', 'nullable', 'string'],
            'timezone' => ['sometimes', 'nullable', 'string', 'timezone'],
            'duration_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:600'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $newStart = $this->resolveInstant($data, $timezone);
        $duration = (int) ($data['duration_minutes'] ?? $session->duration_minutes);

        // 1) The origin row becomes RESCHEDULED — a non-billable, "touched" marker the generator
        //    will never resurrect or duplicate (§4.5, TC-5.9).
        DB::table('sessions')->where('id', $sessionId)->update([
            'status' => 'RESCHEDULED',
            'status_reason' => $data['reason'] ?? null,
            'updated_at' => now(),
        ]);

        // 2) The successor is a normal standalone SCHEDULED row linked back to the origin. It is
        //    NOT tied to the schedule/slot (schedule_id null), so regeneration leaves it alone.
        $successorId = (string) Str::uuid();
        DB::table('sessions')->insert([
            'id' => $successorId,
            'academy_id' => $academyId,
            'student_id' => $session->student_id,
            'teacher_id' => $session->teacher_id,
            'schedule_id' => null,
            'slot_id' => null,
            'occurrence_local_date' => null,
            'scheduled_at_utc' => $newStart->format('Y-m-d H:i:sP'),
            'duration_minutes' => $duration,
            'status' => 'SCHEDULED',
            'original_session_id' => $sessionId,
        ]);

        Audit::log('session.rescheduled', 'session', $sessionId, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['scheduled_at_utc' => Carbon::parse($session->scheduled_at_utc)->utc()->toIso8601String(), 'status' => $session->status],
            after: ['successor_session_id' => $successorId, 'scheduled_at_utc' => $newStart->toIso8601String(), 'status' => 'RESCHEDULED']);

        return response()->json([
            'sessionId' => $successorId,
            'originalSessionId' => $sessionId,
            'warnings' => $this->schedulingWarnings((string) $session->teacher_id, $newStart, $duration, $timezone, $successorId),
        ], 201);
    }

    /**
     * POST /api/sessions/{id}/cancel — set the correct NON-BILLABLE cancel status for one
     * occurrence (§5.3, §5.4). Billable absent outcomes are attendance (Sprint 6), never set
     * here (AC-5.12).
     */
    public function cancel(Request $request, string $sessionId): JsonResponse
    {
        Gate::authorize('session.cancel');

        $academyId = $this->currentAcademyId();
        $session = $this->findOwnedSession($sessionId);

        $data = $request->validate([
            'cancelled_by' => ['required', Rule::in(array_keys(self::NON_BILLABLE_CANCELS))],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $status = self::NON_BILLABLE_CANCELS[$data['cancelled_by']];
        DB::table('sessions')->where('id', $sessionId)->update([
            'status' => $status,
            'status_reason' => $data['reason'] ?? null,
            'updated_at' => now(),
        ]);

        Audit::log('session.cancelled', 'session', $sessionId, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['status' => $session->status],
            after: ['status' => $status, 'cancelled_by' => $data['cancelled_by'], 'reason' => $data['reason'] ?? null]);

        return response()->json(['ok' => true, 'status' => $status]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Load a session in the academy; a TEACHER is further limited to their own sessions (§3.6). */
    private function findOwnedSession(string $sessionId): object
    {
        $session = DB::table('sessions')->where('id', $sessionId)->first();
        if ($session === null) {
            abort(404, 'Session not found.');
        }

        if ($this->ctx()->role === 'TEACHER') {
            $teacherId = $this->callerTeacherId();
            if ($teacherId === null || (string) $session->teacher_id !== $teacherId) {
                abort(403, 'Not your session.');
            }
        }

        return $session;
    }

    private function currentTeacherFor(string $studentId): ?string
    {
        $id = DB::table('student_teacher_assignments')
            ->where('student_id', $studentId)->whereNull('ended_at')->value('teacher_id');

        return $id !== null ? (string) $id : null;
    }

    private function assertActiveTeacher(string $teacherId): void
    {
        if (DB::table('teachers')->where('id', $teacherId)->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['teacher_id' => ['Unknown or inactive teacher.']]);
        }
    }
}
