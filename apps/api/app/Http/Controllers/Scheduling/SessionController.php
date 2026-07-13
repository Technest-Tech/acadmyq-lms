<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Domain\SessionClassifier;
use App\Enums\SessionStatus;
use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\AttendanceService;
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

    /**
     * POST /api/sessions — a one-off session not tied to any schedule (AC-5.10).
     *
     * Gated on `session.create`, which a TEACHER now also holds so they can log a class the
     * timetable never produced (e.g. a make-up lesson). That capability is deliberately narrower
     * than `schedule.manage`: it mints one ad-hoc occurrence, it does NOT let a teacher rewrite a
     * weekly timetable. A TEACHER is confined to their own roster and is always recorded as the
     * teacher, so they can never mint a billable class for someone else's student.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('session.create');

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

        // A TEACHER may only ever create a class for themselves, and only for a student currently
        // assigned to them. Any teacher_id they send is ignored rather than rejected — the caller's
        // own identity is the only one that can hold here.
        if ($this->ctx()->role === 'TEACHER') {
            $ownTeacherId = $this->callerTeacherId();
            if ($ownTeacherId === null) {
                abort(403, 'No teacher record for this user.');
            }
            if ($this->currentTeacherFor($data['student_id']) !== $ownTeacherId) {
                abort(403, 'Not your student.');
            }
            $teacherId = $ownTeacherId;
        }

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

        // A session may be rescheduled only ONCE, and only while it is still SCHEDULED. An origin
        // that is already RESCHEDULED has spawned its successor; one that is cancelled/attended has
        // reached a terminal outcome. Rescheduling it again would mint a second successor — a
        // phantom SCHEDULED row that shows up on the attendance/day view — and that successor would
        // then "overlap" the first, producing the misleading same-teacher conflict warning. Reject
        // up front so the operation is idempotent (the atomic status guard below closes the race
        // where two near-simultaneous submits both pass this check).
        if ($session->status !== 'SCHEDULED') {
            throw ValidationException::withMessages([
                'session' => ['This session can no longer be rescheduled. / لم يعد بالإمكان إعادة جدولة هذه الحصة.'],
            ]);
        }

        $timezone = $data['timezone'] ?? $this->academyTimezone($academyId);
        $newStart = $this->resolveInstant($data, $timezone);
        $duration = (int) ($data['duration_minutes'] ?? $session->duration_minutes);

        // 1) The origin row becomes RESCHEDULED — a non-billable, "touched" marker the generator
        //    will never resurrect or duplicate (§4.5, TC-5.9). The status='SCHEDULED' guard makes
        //    the transition atomic: only the first of two racing submits flips it and proceeds to
        //    create the successor; the loser sees 0 rows and bails without minting a duplicate.
        $claimed = DB::table('sessions')->where('id', $sessionId)->where('status', 'SCHEDULED')->update([
            'status' => 'RESCHEDULED',
            'status_reason' => $data['reason'] ?? null,
            'updated_at' => now(),
        ]);
        if ($claimed === 0) {
            throw ValidationException::withMessages([
                'session' => ['This session can no longer be rescheduled. / لم يعد بالإمكان إعادة جدولة هذه الحصة.'],
            ]);
        }

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
     * POST /api/sessions/{id}/cancel — cancel one occurrence (§5.3, §5.4). A cancellation defaults
     * to non-billable, but the academy may attach a per-session billing override: `charge_student`
     * (bill a late-cancel fee, at the full session price) and/or `pay_teacher`, with `reason` shown
     * to the parent on the resulting invoice line. Routed through {@see AttendanceService} so the
     * billing + payout hooks fire exactly as they do for any other outcome (single source of truth).
     */
    public function cancel(Request $request, AttendanceService $service, string $sessionId): JsonResponse
    {
        Gate::authorize('session.cancel');

        $session = $this->findOwnedSession($sessionId);

        $data = $request->validate([
            'cancelled_by' => ['required', Rule::in(array_keys(self::NON_BILLABLE_CANCELS))],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
            'charge_student' => ['sometimes', 'boolean'],
            'pay_teacher' => ['sometimes', 'boolean'],
        ]);

        $next = SessionStatus::from(self::NON_BILLABLE_CANCELS[$data['cancelled_by']]);
        $billOverride = (bool) ($data['charge_student'] ?? false);
        $teacherOverride = (bool) ($data['pay_teacher'] ?? false);
        $prevStatus = (string) $session->status;

        $result = $service->record($session, $next, $data['reason'] ?? null, $this->ctx()->userId, $this->ctx()->role, $billOverride, $teacherOverride);

        Audit::log('session.cancelled', 'session', $sessionId, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role,
            before: ['status' => $prevStatus],
            after: ['status' => $result['status'], 'cancelled_by' => $data['cancelled_by'], 'reason' => $data['reason'] ?? null, 'charge_student' => $billOverride, 'pay_teacher' => $teacherOverride]);

        return response()->json(['ok' => true, 'status' => $result['status'], 'billed' => $result['billed']]);
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
        $academyName = DB::table('academies')->where('id', $session->academy_id)->value('name');
        $report = DB::table('session_reports')->where('session_id', $sessionId)->first();
        $values = $report !== null ? (json_decode($report->values, true) ?: []) : [];

        // A teacher's cancel OR free request goes through approval, not a direct status change — the
        // session stays SCHEDULED while the request is PENDING. Surface it so the UI can show an
        // "awaiting approval" indicator instead of looking like nothing happened (§9). There is at
        // most one PENDING request per session; split it by type for the two UI affordances.
        $pending = DB::table('session_cancellation_requests')
            ->where('session_id', $sessionId)
            ->where('status', 'PENDING')
            ->orderByDesc('created_at')
            ->first(['id', 'request_type', 'cancel_type', 'reason', 'created_at']);
        $pendingIsFree = $pending !== null && ($pending->request_type ?? 'CANCEL') === 'FREE';
        $pendingCancellation = ($pending !== null && ! $pendingIsFree) ? $pending : null;
        $pendingFree = $pendingIsFree ? $pending : null;

        return response()->json([
            'session' => [
                'id' => (string) $session->id,
                'student_id' => (string) $session->student_id,
                'teacher_id' => (string) $session->teacher_id,
                'student_name' => $student?->full_name,
                'teacher_name' => $teacherName,
                'academy_name' => $academyName,
                'scheduled_at_utc' => Carbon::parse($session->scheduled_at_utc)->utc()->toIso8601String(),
                'duration_minutes' => (int) $session->duration_minutes,
                'status' => (string) $session->status,
                'status_reason' => $session->status_reason,
                'billed' => (bool) $session->billed,
                'outcome_set_at' => $session->outcome_set_at !== null ? Carbon::parse($session->outcome_set_at)->utc()->toIso8601String() : null,
                'classification' => SessionClassifier::classifyValue(
                    (string) $session->status,
                    $session->bill_override !== null ? (bool) $session->bill_override : null,
                    $session->teacher_override !== null ? (bool) $session->teacher_override : null,
                ),
                'pending_cancellation' => $pendingCancellation !== null ? [
                    'id' => (string) $pendingCancellation->id,
                    'cancel_type' => (string) $pendingCancellation->cancel_type,
                    'reason' => $pendingCancellation->reason,
                    'requested_at' => Carbon::parse($pendingCancellation->created_at)->utc()->toIso8601String(),
                ] : null,
                'pending_free' => $pendingFree !== null ? [
                    'id' => (string) $pendingFree->id,
                    'reason' => $pendingFree->reason,
                    'requested_at' => Carbon::parse($pendingFree->created_at)->utc()->toIso8601String(),
                ] : null,
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

    /**
     * GET /api/sessions/day — every session within a local day window [from, to), for the
     * attendance page's day view. Unlike pendingAttendance this is NOT restricted to past
     * SCHEDULED rows, so a trial booked for later today shows up immediately. Supports teacher,
     * status and trial-only filters; a TEACHER is still row-scoped to their own sessions (§3.6).
     */
    public function day(Request $request): JsonResponse
    {
        Gate::authorize('session.read');

        $data = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'status' => ['sometimes', 'nullable', Rule::in([
                'SCHEDULED', 'ATTENDED', 'FREE', 'ABSENT_UNEXCUSED', 'ABSENT_EXCUSED',
                'CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT', 'RESCHEDULED',
            ])],
            'trial_only' => ['sometimes'],
        ]);

        $from = Carbon::parse($data['from'])->utc()->format('Y-m-d H:i:sP');
        $to = Carbon::parse($data['to'])->utc()->format('Y-m-d H:i:sP');

        $query = DB::table('sessions as se')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'se.teacher_id')
            // A teacher's cancel stays as a PENDING request while the session sits SCHEDULED — pull
            // its cancel_type so the row can show "awaiting approval". Only one PENDING request can
            // exist per session (unique index), so this join never fans rows out.
            ->leftJoin('session_cancellation_requests as cr', function ($join) {
                $join->on('cr.session_id', '=', 'se.id')->where('cr.status', '=', 'PENDING');
            })
            ->where('se.scheduled_at_utc', '>=', $from)
            ->where('se.scheduled_at_utc', '<', $to)
            ->select([
                'se.id', 'se.student_id', 'se.teacher_id', 'se.scheduled_at_utc',
                'se.duration_minutes', 'se.status',
                'st.full_name as student_name', 'st.status as student_status',
                'te.full_name as teacher_name',
                'cr.cancel_type as pending_cancel_type',
            ])
            ->orderBy('se.scheduled_at_utc')->orderBy('se.id');

        if (! empty($data['teacher_id'])) {
            $query->where('se.teacher_id', $data['teacher_id']);
        }
        if (! empty($data['status'])) {
            $query->where('se.status', $data['status']);
        } else {
            // A RESCHEDULED row is the old occurrence at its original time, kept only as a
            // non-billable audit marker (its SCHEDULED successor sits at the new time). Hide it by
            // default so a reschedule isn't shown as a duplicate; an explicit ?status=RESCHEDULED
            // still surfaces it for a history view.
            $query->where('se.status', '!=', 'RESCHEDULED');
        }
        if (filter_var($data['trial_only'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $query->whereIn('st.status', ['TRIAL', 'TRIAL_BOOKED']);
        }

        if ($this->ctx()->role === 'TEACHER') {
            $ownTeacherId = $this->callerTeacherId();
            if ($ownTeacherId === null) {
                abort(403, 'No teacher record for this user.');
            }
            $query->where('se.teacher_id', $ownTeacherId);
        }

        $rows = $query->limit(500)->get()->map(function ($r) {
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();

            return $r;
        });

        return response()->json(['sessions' => $rows]);
    }

    /**
     * GET /api/sessions/day/count — the number of SCHEDULED sessions (those still needing an
     * outcome) inside a local-day window [from, to), for the sidebar's Attendance badge. Unlike
     * pendingAttendance this counts the whole day, so a trial booked for later today is included
     * immediately. A TEACHER is row-scoped to their own sessions (§3.6); RLS keeps every caller
     * inside their academy. session.read.
     */
    public function dayCount(Request $request): JsonResponse
    {
        Gate::authorize('session.read');

        $data = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date'],
        ]);

        $from = Carbon::parse($data['from'])->utc()->format('Y-m-d H:i:sP');
        $to = Carbon::parse($data['to'])->utc()->format('Y-m-d H:i:sP');

        $query = DB::table('sessions as se')
            ->where('se.status', 'SCHEDULED')
            ->where('se.scheduled_at_utc', '>=', $from)
            ->where('se.scheduled_at_utc', '<', $to);

        if ($this->ctx()->role === 'TEACHER') {
            $ownTeacherId = $this->callerTeacherId();
            if ($ownTeacherId === null) {
                abort(403, 'No teacher record for this user.');
            }
            $query->where('se.teacher_id', $ownTeacherId);
        }

        return response()->json(['count' => (int) $query->count()]);
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
