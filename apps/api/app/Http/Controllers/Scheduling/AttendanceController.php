<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Domain\SessionClassifier;
use App\Enums\SessionStatus;
use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Services\AttendanceService;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Record a session's outcome (Sprint 6 §2, §8). This is the entry surface for both the Teacher
 * (own sessions, §3.6) and the Owner/support (any session, R-BIL-4): `session.mark_attendance`
 * gates it, RLS isolates the academy, and a TEACHER is additionally row-filtered to sessions
 * they teach (TC-6.22). The five billable/non-billable outcomes are set here; the heavy lifting
 * (classification → billing hook → audit) is delegated to {@see AttendanceService} (§5).
 *
 * The timing gate (§3.7, AC-6.9) prevents marking a future lesson attended; an Owner/Super Admin
 * may override with an audited correction. Non-billable cancels are ALSO settable via the
 * Sprint 5 cancel endpoint; this endpoint is the full outcome surface including the billable
 * ABSENT_* statuses Sprint 5 deliberately left untouched.
 */
final class AttendanceController extends Controller
{
    use InteractsWithScheduling;

    /** The outcomes a human records post-session. SCHEDULED/RESCHEDULED are never set here. The
     *  former ABSENT_* outcomes were retired: the academy now expresses "no-show but still charge"
     *  via a cancellation with a billing override instead. */
    private const OUTCOME_STATUSES = [
        'ATTENDED',
        'FREE',
        'CANCELLED_BY_TEACHER',
        'CANCELLED_BY_STUDENT',
    ];

    /**
     * Cancel outcomes. These are a CANCELLATION, not an attendance outcome: an actor who cannot
     * cancel directly (a Teacher, who holds session.cancel_request not session.cancel) must route
     * them through the approval flow (CancellationRequestController), never set them here —
     * otherwise the attendance page becomes a back door around owner approval. When an owner DOES
     * cancel here, they may attach a per-session billing override (charge_student / pay_teacher).
     */
    private const CANCEL_STATUSES = [
        'CANCELLED_BY_TEACHER',
        'CANCELLED_BY_STUDENT',
    ];

    /** POST /api/sessions/{id}/attendance — gated by session.mark_attendance (+ teacher filter). */
    public function store(Request $request, AttendanceService $service, string $sessionId): JsonResponse
    {
        Gate::authorize('session.mark_attendance');

        $academyId = $this->currentAcademyId();
        $session = $this->findOwnedSession($sessionId);

        $data = $request->validate([
            'status' => ['required', Rule::in(self::OUTCOME_STATUSES)],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
            'override_timing' => ['sometimes', 'boolean'],
            // Per-cancellation billing decision (owner-only; ignored for non-cancel outcomes).
            'charge_student' => ['sometimes', 'boolean'],
            'pay_teacher' => ['sometimes', 'boolean'],
        ]);

        $isCancel = in_array($data['status'], self::CANCEL_STATUSES, true);
        $isFree = $data['status'] === 'FREE';

        // A cancel is not an attendance outcome: an actor without session.cancel (a Teacher) may
        // not cancel directly here — they must raise a cancellation request for the owner to
        // approve (Sprint 9). Block the back door regardless of what the UI sends.
        if ($isCancel && ! Gate::allows('session.cancel')) {
            throw ValidationException::withMessages([
                'status' => ['You can’t cancel a class directly — send a cancellation request for the owner to approve. / لا يمكنك إلغاء الحصة مباشرة — أرسل طلب إلغاء ليوافق عليه المالك.'],
            ]);
        }

        // Marking a lesson FREE carries the same per-academy billing decision as a cancellation, so
        // it follows the same rule: a Teacher (session.free_request, not session.free) can't apply
        // it directly — they raise a free request for the owner to approve. Block the back door.
        if ($isFree && ! Gate::allows('session.free')) {
            throw ValidationException::withMessages([
                'status' => ['You can’t mark a lesson free directly — send a request for the owner to approve. / لا يمكنك جعل الحصة مجانية مباشرة — أرسل طلبًا ليوافق عليه المالك.'],
            ]);
        }

        $next = SessionStatus::from($data['status']);
        $this->assertTimingAllowed($session, (bool) ($data['override_timing'] ?? false), $academyId);

        // Charge-student / pay-teacher overrides apply to a cancellation OR a free lesson (both let
        // the academy decide the billing per occurrence); a plain ATTENDED outcome keeps the
        // status-derived verdict (null overrides).
        $overridable = $isCancel || $isFree;
        $billOverride = $overridable ? (bool) ($data['charge_student'] ?? false) : null;
        $teacherOverride = $overridable ? (bool) ($data['pay_teacher'] ?? false) : null;

        $result = $service->record($session, $next, $data['reason'] ?? null, $this->ctx()->userId, $this->ctx()->role, $billOverride, $teacherOverride);

        return response()->json([
            'status' => $result['status'],
            'billed' => $result['billed'],
            'classification' => SessionClassifier::classify($next, $billOverride, $teacherOverride),
        ]);
    }

    /**
     * POST /api/sessions/{id}/attendance/revert — take back a recorded outcome and put the lesson
     * back to SCHEDULED. Gated by `session.revert_attendance`, which a TEACHER does not hold:
     * reverting reverses money (the invoice line, the payout accrual) and would otherwise be a way
     * to undo a cancellation the owner had just approved.
     *
     * This is the ONLY way out of a wrongly-marked lesson, and the precondition for moving it:
     * {@see SessionController::reschedule} refuses anything that is not SCHEDULED.
     *
     * The reconciliation and its guards live in {@see AttendanceService::revert} — a closed invoice
     * or a finalized payout refuses the revert rather than silently leaving the money behind.
     */
    public function revert(AttendanceService $service, string $sessionId): JsonResponse
    {
        Gate::authorize('session.revert_attendance');

        $session = $this->findOwnedSession($sessionId);
        $current = SessionStatus::from((string) $session->status);

        if ($current === SessionStatus::Scheduled) {
            throw ValidationException::withMessages([
                'status' => ['This lesson is already pending — there is nothing to undo. / هذه الحصة معلّقة بالفعل، لا يوجد ما يمكن التراجع عنه.'],
            ]);
        }

        // A RESCHEDULED row is not an outcome, it is a MOVED lesson: its replacement already exists
        // as a separate SCHEDULED occurrence. Putting this one back would leave the student with
        // two live lessons and let it be rescheduled a second time, minting a third.
        if ($current === SessionStatus::Rescheduled) {
            throw ValidationException::withMessages([
                'status' => ['This lesson was moved to a new time; undo it from the lesson that replaced it. / تم نقل هذه الحصة إلى موعد جديد؛ تراجع عنها من الحصة التي حلّت محلها.'],
            ]);
        }

        $result = $service->revert($session, $this->ctx()->userId, $this->ctx()->role);

        return response()->json([
            'status' => $result['status'],
            'billed' => $result['billed'],
            'classification' => SessionClassifier::classify(SessionStatus::Scheduled),
        ]);
    }

    /**
     * Block recording an outcome on a session still in the future beyond the configured grace
     * (§3.7). An Owner/Super Admin may override (`override_timing`), which is audited; a Teacher
     * cannot. The grace lets "now-ish" sessions be marked while keeping clearly-future ones safe.
     */
    private function assertTimingAllowed(object $session, bool $override, string $academyId): void
    {
        $grace = (int) config('attendance.grace_minutes', 0);
        $startUtc = Carbon::parse($session->scheduled_at_utc)->utc();
        $threshold = $startUtc->copy()->subMinutes($grace);

        if (now()->lt($threshold)) {
            $isOwner = in_array($this->ctx()->role, ['ACADEMY_OWNER', 'SUPER_ADMIN'], true);
            if (! ($override && $isOwner)) {
                throw ValidationException::withMessages([
                    'status' => ['This session has not started yet; attendance cannot be recorded. / لم تبدأ هذه الحصة بعد، لا يمكن تسجيل الحضور.'],
                ]);
            }

            Audit::log('session.attendance_override', 'session', (string) $session->id, $academyId, $this->ctx()->userId, $this->ctx()->role,
                after: ['scheduled_at_utc' => $startUtc->toIso8601String(), 'override' => true]);
        }
    }
}
