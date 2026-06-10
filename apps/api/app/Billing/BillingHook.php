<?php

declare(strict_types=1);

namespace App\Billing;

/**
 * The integration seam between Sprint 6 (which owns *when* a session becomes billable) and
 * Sprint 7 (which owns *the money*). Sprint 6's AttendanceService decides the firing conditions
 * and guards (the §5 pseudocode: the `billed` idempotency guard, the invoice-OPEN/CLOSED check)
 * and delegates the actual line-item create/remove to this hook. Sprint 7 swaps in the real
 * implementation that snapshots the subscription price and recomputes invoice totals; this
 * sprint binds a concrete MVP implementation ({@see InvoiceBillingHook}) that wires the seam
 * end-to-end with a zero-amount placeholder line item — no money math (AC-6.13).
 *
 * Idempotency is the CALLER's responsibility via `sessions.billed`; this hook is only invoked
 * on a genuine transition, but it also uses the Sprint 1 unique `(invoice_id, session_id)`
 * constraint as a concurrency backstop so it can never create a duplicate line (R-BIL-1).
 *
 * @param object $session a `sessions` row (stdClass from the query builder)
 */
interface BillingHook
{
    /** A session became billable to the student → ensure exactly one line item exists for it. */
    public function onSessionBillable(object $session): void;

    /**
     * A session is no longer billable (corrected before the invoice closed) → remove its pending
     * line item. The caller has already verified the invoice is still OPEN (§5 immutability).
     */
    public function onSessionUnbilled(object $session): void;
}
