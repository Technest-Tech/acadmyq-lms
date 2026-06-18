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
            'outcome_set_at' => now(),
            'outcome_set_by' => $actorUserId,
            'updated_at' => now(),
        ]);

        Audit::log(
            'session.status_changed',
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
