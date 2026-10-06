<?php

declare(strict_types=1);

namespace App\Services;

use App\Billing\BillingHook;
use App\Domain\SessionClassifier;
use App\Enums\SessionStatus;
use App\Payroll\PayoutHook;
use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The heart of Sprint 6: record a session's outcome and reconcile billing, exactly per the §5
 * pseudocode. This is a small transactional unit deliberately separated from HTTP concerns
 * (teacher scoping, the timing gate) so it can be exhaustively tested. It runs inside the
 * request's tenant transaction (set by TenantContextMiddleware), so any throw — e.g. the
 * closed-invoice rejection — rolls the whole outcome back atomically.
 *
 * Billing classification is ALWAYS derived from status via {@see SessionClassifier} (decision
 * §3.1); `sessions.billed` / `sessions.paid_to_teacher` are only idempotency guards. The
 * {@see BillingHook} (Sprint 7 seam) does the invoice line-item create/remove and the
 * {@see PayoutHook} (Sprint 8 seam) does the payout line-item accrue/reverse; the firing
 * CONDITIONS and the OPEN/CLOSED + finalize guards live here. A single status change can move
 * BOTH money documents (student invoice and teacher payout), each guarded independently, all in
 * this one tenant transaction — so a rejection in either rolls the whole outcome back atomically.
 */
final class AttendanceService
{
    public function __construct(
        private readonly BillingHook $hook,
        private readonly PayoutHook $payoutHook,
    ) {}

    /**
     * Apply $next to $session, firing/reversing the billing hook idempotently and auditing the
     * before/after (R-AUD-1). $session is the row as loaded BEFORE the change.
     *
     * Cancellations (CANCELLED_BY_*) may carry a per-session billing override: $billOverride /
     * $teacherOverride (null = use the status default). When the academy chooses to still charge a
     * cancellation, $reason is what the parent sees on the resulting invoice line — so we stamp the
     * new status + reason onto the in-memory $session BEFORE firing the billing hook, which reads
     * them to label the line "Cancelled session … — <reason>".
     *
     * @return array{status: string, billed: bool, billingAction: ?string}
     */
    public function record(object $session, SessionStatus $next, ?string $reason, string $actorUserId, string $actorRole, ?bool $billOverride = null, ?bool $teacherOverride = null): array
    {
        return $this->apply($session, $next, $reason, $actorUserId, $actorRole, $billOverride, $teacherOverride, recorded: true);
    }

    /**
     * Undo a recorded outcome: put the lesson back to SCHEDULED as if nobody had marked it.
     *
     * This is deliberately the SAME code path as {@see record}, because "undo" here means exactly
     * what the classifier already says about SCHEDULED — not billable, doesn't count for the
     * teacher — so the reconciliation below removes the invoice line (or releases the package
     * minutes) and reverses the payout accrual on its own, under the same guards. A closed invoice
     * or a finalized payout therefore refuses the revert with the same message it refuses any
     * other un-billing: the money has left the building and the lesson can no longer be un-marked.
     *
     * What a revert additionally clears is the record of the marking itself — the reason, the
     * per-occurrence billing overrides, and who marked it when — so the lesson re-enters the
     * pending/overdue worklists as untouched work rather than as a marked lesson wearing a
     * SCHEDULED badge. The lesson can then be rescheduled, which requires SCHEDULED.
     *
     * @return array{status: string, billed: bool, billingAction: ?string}
     */
    public function revert(object $session, string $actorUserId, string $actorRole): array
    {
        return $this->apply($session, SessionStatus::Scheduled, null, $actorUserId, $actorRole, null, null, recorded: false);
    }

    /**
     * @param  bool  $recorded  True when a human is RECORDING an outcome (stamp who/when), false
     *                          when they are taking one back (clear the stamp).
     * @return array{status: string, billed: bool, billingAction: ?string}
     */
    private function apply(object $session, SessionStatus $next, ?string $reason, string $actorUserId, string $actorRole, ?bool $billOverride, ?bool $teacherOverride, bool $recorded): array
    {
        $prev = (string) $session->status;
        $wasBilled = (bool) $session->billed;
        $wasPaidToTeacher = (bool) $session->paid_to_teacher;
        $verdict = SessionClassifier::classify($next, $billOverride, $teacherOverride);

        // The billing/payout hooks read the session row for date, amount and (now) the line
        // description. Stamp the outcome we're applying so a charged cancellation's line shows the
        // right status + reason to the parent rather than the pre-change values.
        $session->status = $next->value;
        $session->status_reason = $reason;

        $billed = $wasBilled;
        $billingAction = null;
        $paidToTeacher = $wasPaidToTeacher;
        $payrollAction = null;

        // §5: reconcile billing BEFORE persisting the status so a closed-period rejection rolls
        // back cleanly and the row is never left in a billed/un-billed-inconsistent state.
        if ($verdict['billableToStudent'] && ! $wasBilled) {
            $this->hook->onSessionBillable($session);          // Sprint 7 adds the line item
            $billed = true;
            $billingAction = 'billed';
        } elseif (! $verdict['billableToStudent'] && $wasBilled) {
            $invoiceStatus = $this->invoiceStatusFor((string) $session->id);
            if ($invoiceStatus !== null && $invoiceStatus !== 'OPEN') {
                // Immutability after close (R-INV-3, TC-6.12): cannot un-bill a closed invoice.
                throw ValidationException::withMessages([
                    'status' => ["This session's invoice is already closed and can no longer be changed. / فاتورة هذه الحصة مُقفلة ولا يمكن تعديل حالتها."],
                ]);
            }
            $this->hook->onSessionUnbilled($session);          // Sprint 7 removes the pending line
            $billed = false;
            $billingAction = 'unbilled';
        }
        // Otherwise (billable→billable e.g. ABSENT_UNEXCUSED→ATTENDED, or non-billable→non-billable)
        // the guard already matches the verdict: no hook fires, no duplicate line (TC-6.8/6.10/6.13).

        // Sprint 8: reconcile the teacher payout off the SAME status change, guarded independently
        // by `paid_to_teacher`. Only ATTENDED counts for the teacher (countsForTeacher), so e.g.
        // ABSENT_UNEXCUSED bills the student above but pays nothing here (AC-8.2). onSessionUnattended
        // rejects if the payout is already finalized (AC-8.5) — that throw also rolls back any
        // invoice line just removed, keeping both documents consistent.
        if ($verdict['countsForTeacher'] && ! $wasPaidToTeacher) {
            $this->payoutHook->onSessionAttended($session);    // accrue the payout line (snapshot rate)
            $paidToTeacher = true;
            $payrollAction = 'accrued';
        } elseif (! $verdict['countsForTeacher'] && $wasPaidToTeacher) {
            $this->payoutHook->onSessionUnattended($session);  // reverse the payout line (if not finalized)
            $paidToTeacher = false;
            $payrollAction = 'reversed';
        }

        DB::table('sessions')->where('id', $session->id)->update([
            'status' => $next->value,
            'status_reason' => $reason,
            'bill_override' => $billOverride,
            'teacher_override' => $teacherOverride,
            'billed' => $billed,
            'paid_to_teacher' => $paidToTeacher,
            // A revert leaves no outcome behind: the lesson has to look untouched to the pending
            // and overdue worklists, which read these two columns as "somebody dealt with this".
            // An explicit offset: bound naked, this instant is read in the Postgres session's zone
            // and lands hours off — and the Supervision page measures marking delay from it.
            'outcome_set_at' => $recorded ? now()->toIso8601String() : null,
            'outcome_set_by' => $recorded ? $actorUserId : null,
            'updated_at' => now(),
        ]);

        $this->syncAttendedNotification($session, $prev, $next, $recorded, $actorUserId, $actorRole);

        Audit::log(
            $recorded ? 'session.status_changed' : 'session.outcome_reverted',
            'session',
            (string) $session->id,
            (string) $session->academy_id,
            $actorUserId,
            $actorRole,
            after: ['status' => $next->value, 'billed' => $billed, 'billing_action' => $billingAction, 'paid_to_teacher' => $paidToTeacher, 'payroll_action' => $payrollAction, 'reason' => $reason, 'bill_override' => $billOverride, 'teacher_override' => $teacherOverride],
            before: ['status' => $prev, 'billed' => $wasBilled, 'paid_to_teacher' => $wasPaidToTeacher],
        );

        return ['status' => $next->value, 'billed' => $billed, 'billingAction' => $billingAction, 'paidToTeacher' => $paidToTeacher, 'payrollAction' => $payrollAction];
    }

    /**
     * Keep the Notifications page's "Attended classes" feed in step with the lesson.
     *
     * One LESSON_ATTENDED row per lesson, written the moment it is RECORDED as attended, so the
     * owner sees each delivered lesson as it lands. It is an activity log rather than a to-do:
     * its category (ATTENDED) is counted on its own tab and never on the sidebar bell, or a busy
     * academy's fifty lessons a day would bury the alerts that need acting on. A lesson corrected
     * away from ATTENDED (cancelled, freed, reverted) loses its row, because "attended" would now
     * be false; the unique (session_id, type) index keeps a re-mark from duplicating it.
     */
    private function syncAttendedNotification(object $session, string $prev, SessionStatus $next, bool $recorded, string $actorUserId, string $actorRole): void
    {
        if ($recorded && $next === SessionStatus::Attended) {
            if ($prev === SessionStatus::Attended->value) {
                return;
            }

            DB::table('notifications')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'academy_id' => $session->academy_id,
                'type' => 'LESSON_ATTENDED',
                'category' => 'ATTENDED',
                'audience_role' => 'ACADEMY_OWNER',
                'recipient_user_id' => null,
                'session_id' => $session->id,
                'data' => json_encode([
                    'student_name' => DB::table('students')->where('id', $session->student_id)->value('full_name'),
                    'teacher_name' => DB::table('teachers')->where('id', $session->teacher_id)->value('full_name'),
                    'teacher_id' => (string) $session->teacher_id,
                    'scheduled_at_utc' => Carbon::parse($session->scheduled_at_utc)->utc()->toIso8601String(),
                    'duration_minutes' => (int) $session->duration_minutes,
                    'marked_by_name' => DB::table('users')->where('id', $actorUserId)->value('full_name'),
                    'marked_by_role' => $actorRole,
                ], JSON_UNESCAPED_UNICODE),
            ]);

            return;
        }

        if ($prev === SessionStatus::Attended->value) {
            DB::table('notifications')
                ->where('session_id', $session->id)
                ->where('type', 'LESSON_ATTENDED')
                ->delete();
        }
    }

    /** The status of the invoice carrying this session's line item, or null if none exists yet. */
    private function invoiceStatusFor(string $sessionId): ?string
    {
        $line = DB::table('invoice_line_items')->where('session_id', $sessionId)->first();
        if ($line === null) {
            return null;
        }

        $status = DB::table('invoices')->where('id', $line->invoice_id)->value('status');

        return $status !== null ? (string) $status : null;
    }
}
