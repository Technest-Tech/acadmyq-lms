<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Domain\SessionClassifier;
use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use App\Support\ReportFields;
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

    /**
     * GET /api/sessions/{id} — one session with its report (if any) and the academy's active
     * report-field definitions (the form for new entry). Deactivated fields that still carry a
     * value in this report are returned separately so the UI can render them read-only (AC-6.6).
     * session.read; a Teacher sees only their own sessions (§3.6).
     */
    public function show(string $sessionId): JsonResponse
    {
        Gate::authorize('session.read');

        $session = $this->findOwnedSession($sessionId);

        $student = DB::table('students')->where('id', $session->student_id)->first(['id', 'full_name', 'guardian_id']);
        $teacherName = DB::table('teachers')->where('id', $session->teacher_id)->value('full_name');
        $report = DB::table('session_reports')->where('session_id', $sessionId)->first();
        $values = $report !== null ? (json_decode($report->values, true) ?: []) : [];

        return response()->json([
            'session' => [
                'id' => (string) $session->id,
                'student_id' => (string) $session->student_id,
                'teacher_id' => (string) $session->teacher_id,
                'student_name' => $student?->full_name,
                'teacher_name' => $teacherName,
                'scheduled_at_utc' => Carbon::parse($session->scheduled_at_utc)->utc()->toIso8601String(),
                'duration_minutes' => (int) $session->duration_minutes,
                'status' => (string) $session->status,
                'status_reason' => $session->status_reason,
                'billed' => (bool) $session->billed,
                'outcome_set_at' => $session->outcome_set_at !== null ? Carbon::parse($session->outcome_set_at)->utc()->toIso8601String() : null,
                'classification' => SessionClassifier::classifyValue((string) $session->status),
            ],
            'report' => $report !== null ? [
                'values' => $values,
                'filled_by_user_id' => $report->filled_by_user_id,
                'filled_at' => $report->filled_at !== null ? Carbon::parse($report->filled_at)->utc()->toIso8601String() : null,
                'whatsapp_sent_at' => $report->whatsapp_sent_at !== null ? Carbon::parse($report->whatsapp_sent_at)->utc()->toIso8601String() : null,
                'whatsapp_channel' => $report->whatsapp_channel,
            ] : null,
            'reportFields' => ReportFields::active((string) $session->academy_id),
            'inactiveReportFields' => ReportFields::inactiveWithValues((string) $session->academy_id, $values),
        ]);
    }

    /**
     * GET /api/sessions/pending-attendance — sessions whose time has passed but still sit in
     * SCHEDULED, i.e. they need an outcome (§8). A Teacher sees only their own (§3.6); RLS keeps
     * every caller inside their academy. session.read.
     */
    public function pendingAttendance(): JsonResponse
    {
        Gate::authorize('session.read');

        $query = DB::table('sessions as se')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            ->where('se.status', 'SCHEDULED')
            ->where('se.scheduled_at_utc', '<=', now()->format('Y-m-d H:i:sP'))
            ->select([
                'se.id', 'se.student_id', 'se.teacher_id', 'se.scheduled_at_utc',
                'se.duration_minutes', 'se.status',
                'st.full_name as student_name', 'te.full_name as teacher_name',
            ])
            ->orderBy('se.scheduled_at_utc')->orderBy('se.id');

        if ($this->ctx()->role === 'TEACHER') {
            $ownTeacherId = $this->callerTeacherId();
            if ($ownTeacherId === null) {
                abort(403, 'No teacher record for this user.');
            }
            $query->where('se.teacher_id', $ownTeacherId);
        }

        $rows = $query->limit(200)->get()->map(function ($r) {
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();

            return $r;
        });

        return response()->json(['sessions' => $rows]);
    }

    // ── internals ────────────────────────────────────────────────────────────

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
