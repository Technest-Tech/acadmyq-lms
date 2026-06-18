<?php

declare(strict_types=1);

namespace App\Payroll;

/**
 * The integration seam between Sprint 6 (which owns *when* a session's teacher attribution
 * changes) and Sprint 8 (which owns *the teacher's money*). Sprint 6's AttendanceService
 * decides the firing conditions and guards — exactly as it does for the {@see \App\Billing\BillingHook}
 * student-invoice seam — and delegates the payout line-item accrue/reverse to this hook. The two
 * documents are coordinated by a single status change but guarded independently: `sessions.billed`
 * for invoices, `sessions.paid_to_teacher` here (Sprint 1 §6.5, decision §3.3).
 *
 * Classification is ALWAYS derived from status via {@see \App\Domain\SessionClassifier::countsForTeacher}
 * (decision §3.1); `paid_to_teacher` is only an idempotency guard. A line accrues on the open
 * payout for the session's teacher (`sessions.teacher_id`, the actual deliverer — decision §4) at
 * the rate snapshotted at attendance time. The Sprint 1 unique `(payout_id, session_id)` constraint
 * is the concurrency backstop so a duplicate line can never be created (R-PAY-2).
 *
 * @param object $session a `sessions` row (stdClass from the query builder)
 */
interface PayoutHook
{
    /**
     * A session became ATTENDED → accrue exactly one payout line to the session's teacher on the
     * period's OPEN payout, with the teacher's rate + currency snapshotted now (R-PAY-1/3).
     */
    public function onSessionAttended(object $session): void;

    /**
     * A session is no longer ATTENDED (corrected before the payout is finalized) → remove its
     * pending payout line and reverse the total. Rejects if the payout is already finalized
     * (immutability, AC-8.5).
     */
    public function onSessionUnattended(object $session): void;
}
