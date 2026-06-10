<?php

declare(strict_types=1);

namespace App\Services;

use App\Billing\BillingHook;
use App\Domain\SessionClassifier;
use App\Enums\SessionStatus;
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
 * §3.1); `sessions.billed` is only an idempotency guard. The {@see BillingHook} (Sprint 7 seam)
 * does the line-item create/remove; the firing CONDITIONS and the OPEN/CLOSED guard live here.
 */
final class AttendanceService
{
    public function __construct(private readonly BillingHook $hook) {}

    /**
     * Apply $next to $session, firing/reversing the billing hook idempotently and auditing the
     * before/after (R-AUD-1). $session is the row as loaded BEFORE the change.
     *
     * @return array{status: string, billed: bool, billingAction: ?string}
     */
    public function record(object $session, SessionStatus $next, ?string $reason, string $actorUserId, string $actorRole): array
    {
        $prev = (string) $session->status;
        $wasBilled = (bool) $session->billed;
        $verdict = SessionClassifier::classify($next);

        $billed = $wasBilled;
        $billingAction = null;

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

        DB::table('sessions')->where('id', $session->id)->update([
            'status' => $next->value,
            'status_reason' => $reason,
            'billed' => $billed,
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
            after: ['status' => $next->value, 'billed' => $billed, 'billing_action' => $billingAction, 'reason' => $reason],
            before: ['status' => $prev, 'billed' => $wasBilled],
        );

        return ['status' => $next->value, 'billed' => $billed, 'billingAction' => $billingAction];
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
