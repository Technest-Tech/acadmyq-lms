<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Enums\SessionStatus;
use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\AttendanceService;
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
 * Teacher cancellation requests + the owner's approval queue (the Notifications "Classes" tab).
 *
 * A TEACHER no longer cancels a class directly (they lost session.cancel): instead they raise a
 * PENDING request here while the session stays SCHEDULED. The OWNER approves it — which performs
 * the actual non-billable cancel (CANCELLED_BY_TEACHER/STUDENT, identical to SessionController::
 * cancel) — or rejects it, leaving the session untouched. Every transition is audited; RLS scopes
 * every row to the academy and a TEACHER is further row-filtered to their own sessions (§3.6).
 */
final class CancellationRequestController extends Controller
{
    use InteractsWithScheduling;

    /** cancel_type → the non-billable status an approval applies (mirrors SessionController). */
    private const CANCEL_STATUS = [
        'teacher' => 'CANCELLED_BY_TEACHER',
        'student' => 'CANCELLED_BY_STUDENT',
    ];

    /**
     * POST /api/sessions/{id}/cancellation-request — a teacher asks to cancel one occurrence
     * (by the teacher, or because the student cancelled). The session is NOT changed; a PENDING
     * request is created for the owner to decide. session.cancel_request (+ own-session filter).
     */
    public function store(Request $request, string $sessionId): JsonResponse
    {
        Gate::authorize('session.cancel_request');

        $academyId = $this->currentAcademyId();
        $session = $this->findOwnedSession($sessionId);

        if ($session->status !== 'SCHEDULED') {
            throw ValidationException::withMessages([
                'session' => ['Only a scheduled class can be requested for cancellation. / لا يمكن طلب إلغاء سوى حصة مجدولة.'],
            ]);
        }

        $data = $request->validate([
            'cancelled_by' => ['required', Rule::in(array_keys(self::CANCEL_STATUS))],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $teacherId = (string) $session->teacher_id;

        if (DB::table('session_cancellation_requests')
            ->where('session_id', $sessionId)->where('status', 'PENDING')->exists()) {
            throw ValidationException::withMessages([
                'session' => ['A cancellation request for this class is already pending. / يوجد طلب إلغاء معلّق لهذه الحصة بالفعل.'],
            ]);
        }

        $id = (string) Str::uuid();
        DB::table('session_cancellation_requests')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'session_id' => $sessionId,
            'teacher_id' => $teacherId,
            'requested_by_user_id' => $this->ctx()->userId,
            'cancel_type' => $data['cancelled_by'],
            'reason' => $data['reason'] ?? null,
            'status' => 'PENDING',
        ]);

        Audit::log('session.cancellation_requested', 'session_cancellation_request', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'session_id' => $sessionId,
            'cancel_type' => $data['cancelled_by'],
            'reason' => $data['reason'] ?? null,
        ]);

        return response()->json(['requestId' => $id, 'status' => 'PENDING'], 201);
    }

    /**
     * GET /api/cancellation-requests — the owner's approval queue: every request in the academy.
     * Optional ?status= filter. notification.read (owner-only — teachers have no Notifications
     * page, they only raise requests via session.cancel_request).
     */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('notification.read');

        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(['PENDING', 'APPROVED', 'REJECTED'])],
        ]);

        $query = DB::table('session_cancellation_requests as r')
            ->join('sessions as se', 'se.id', '=', 'r.session_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'r.teacher_id')
            ->leftJoin('users as du', 'du.id', '=', 'r.decided_by_user_id')
            ->select([
                'r.id', 'r.session_id', 'r.teacher_id', 'r.cancel_type', 'r.reason',
                'r.status', 'r.decided_at', 'r.decision_note', 'r.seen_by_teacher_at', 'r.created_at',
                'se.scheduled_at_utc', 'se.duration_minutes', 'se.status as session_status',
                'st.full_name as student_name', 'te.full_name as teacher_name',
                'du.full_name as decided_by_name',
            ])
            ->orderByRaw("case when r.status = 'PENDING' then 0 else 1 end")
            ->orderByDesc('r.created_at');

        if (! empty($data['status'])) {
            $query->where('r.status', $data['status']);
        }

        $rows = $query->limit(200)->get()->map(function ($r) {
            $r->scheduled_at_utc = Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String();
            $r->created_at = Carbon::parse($r->created_at)->utc()->toIso8601String();
            $r->decided_at = $r->decided_at !== null ? Carbon::parse($r->decided_at)->utc()->toIso8601String() : null;
            $r->duration_minutes = (int) $r->duration_minutes;

            return $r;
        });

        return response()->json(['requests' => $rows]);
    }

    /**
     * POST /api/cancellation-requests/{id}/approve — the owner confirms the cancellation. This
     * performs the actual cancel on the session (status untouched until now) and seals the request
     * APPROVED. The owner decides here, per cancellation, whether to still charge the student
     * (`charge_student`, billed at the full session price) and/or pay the teacher (`pay_teacher`),
     * with an optional `reason` shown to the parent on the invoice line (defaults to the teacher's
     * original request reason). session.cancel_approve.
     */
    public function approve(Request $request, AttendanceService $service, string $requestId): JsonResponse
    {
        Gate::authorize('session.cancel_approve');

        $data = $request->validate([
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
            'charge_student' => ['sometimes', 'boolean'],
            'pay_teacher' => ['sometimes', 'boolean'],
        ]);

        return $this->decide(
            $requestId,
            approve: true,
            note: $data['note'] ?? null,
            service: $service,
            billOverride: (bool) ($data['charge_student'] ?? false),
            teacherOverride: (bool) ($data['pay_teacher'] ?? false),
            reasonOverride: $data['reason'] ?? null,
        );
    }

    /**
     * POST /api/cancellation-requests/{id}/reject — the owner declines; the class stays SCHEDULED.
     * session.cancel_approve.
     */
    public function reject(Request $request, string $requestId): JsonResponse
    {
        Gate::authorize('session.cancel_approve');

        $data = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:500']]);

        return $this->decide($requestId, approve: false, note: $data['note'] ?? null);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function decide(
        string $requestId,
        bool $approve,
        ?string $note,
        ?AttendanceService $service = null,
        bool $billOverride = false,
        bool $teacherOverride = false,
        ?string $reasonOverride = null,
    ): JsonResponse {
        $academyId = $this->currentAcademyId();

        return DB::transaction(function () use ($requestId, $approve, $note, $academyId, $service, $billOverride, $teacherOverride, $reasonOverride) {
            $req = DB::table('session_cancellation_requests')->where('id', $requestId)->lockForUpdate()->first();
            if ($req === null) {
                abort(404, 'Request not found.');
            }
            if ($req->status !== 'PENDING') {
                throw ValidationException::withMessages([
                    'request' => ['This request has already been decided. / تم البتّ في هذا الطلب من قبل.'],
                ]);
            }

            $status = $approve ? 'APPROVED' : 'REJECTED';
            DB::table('session_cancellation_requests')->where('id', $requestId)->update([
                'status' => $status,
                'decided_by_user_id' => $this->ctx()->userId,
                'decided_at' => now(),
                'decision_note' => $note,
                'seen_by_teacher_at' => null, // re-surface the fresh decision to the teacher
                'updated_at' => now(),
            ]);

            $sessionStatus = null;
            if ($approve) {
                // Perform the actual cancel through the billing engine — identical path to a direct
                // cancel (SessionController::cancel), but only ever reached through owner approval.
                // The owner's billing decision (charge_student / pay_teacher) and reason apply here.
                $session = DB::table('sessions')->where('id', $req->session_id)->first();
                $sessionStatus = self::CANCEL_STATUS[$req->cancel_type];
                $reason = $reasonOverride ?? $req->reason;

                $service?->record(
                    $session,
                    SessionStatus::from($sessionStatus),
                    $reason,
                    $this->ctx()->userId,
                    $this->ctx()->role,
                    $billOverride,
                    $teacherOverride,
                );

                Audit::log('session.cancelled', 'session', (string) $req->session_id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                    before: ['status' => $session?->status],
                    after: ['status' => $sessionStatus, 'cancelled_by' => $req->cancel_type, 'reason' => $reason, 'charge_student' => $billOverride, 'pay_teacher' => $teacherOverride, 'via' => 'approval']);
            }

            Audit::log($approve ? 'session.cancellation_approved' : 'session.cancellation_rejected',
                'session_cancellation_request', $requestId, $academyId, $this->ctx()->userId, $this->ctx()->role,
                before: ['status' => 'PENDING'],
                after: ['status' => $status, 'note' => $note, 'session_id' => (string) $req->session_id]);

            return response()->json(['ok' => true, 'status' => $status, 'sessionStatus' => $sessionStatus]);
        });
    }
}
