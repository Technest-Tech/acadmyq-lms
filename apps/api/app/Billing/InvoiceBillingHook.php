<?php

declare(strict_types=1);

namespace App\Billing;

use App\Support\PublicInvoiceToken;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The MVP billing hook (Sprint 6 §5). It wires the seam end-to-end so the firing conditions and
 * idempotency guards are genuinely exercised by the boundary tests — without doing any money
 * math, which is Sprint 7's job (AC-6.13):
 *
 *  - finds (or opens) the OPEN monthly invoice for the session's payer, per the academy's
 *    `invoice_grouping` (PER_GUARDIAN → the student's guardian; PER_STUDENT → the student), in
 *    the academy-local month of the session;
 *  - inserts ONE line item for the session, amount_minor = 0 (Sprint 7 replaces this with the
 *    price snapshot from the subscription and recomputes the invoice totals).
 *
 * `insertOrIgnore` on the Sprint 1 unique `(invoice_id, session_id)` is a concurrency backstop:
 * even without the `billed` guard a second call can never create a duplicate line (R-BIL-1).
 *
 * Runs inside the request's tenant transaction (GUCs already set), so every write is RLS-scoped
 * to the session's academy.
 */
final class InvoiceBillingHook implements BillingHook
{
    public function onSessionBillable(object $session): void
    {
        $academy = DB::table('academies')->where('id', $session->academy_id)->first();
        if ($academy === null) {
            return;
        }

        $tz = $academy->timezone ?: 'UTC';
        $local = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz);

        [$guardianId, $studentId] = $this->payer($academy, $session);
        $invoiceId = $this->ensureOpenInvoice($academy, $guardianId, $studentId, (int) $local->year, (int) $local->month);

        DB::table('invoice_line_items')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'academy_id' => $session->academy_id,
            'invoice_id' => $invoiceId,
            'session_id' => $session->id,
            'student_id' => $session->student_id,
            'description' => 'Session '.$local->format('Y-m-d H:i'),
            'amount_minor' => 0, // Sprint 7 snapshots the real price and recomputes totals.
            'currency' => $academy->default_currency,
        ]);
    }

    public function onSessionUnbilled(object $session): void
    {
        // The caller (AttendanceService) only reaches here when the invoice is still OPEN, so the
        // closed-invoice immutability trigger is never tripped. Removing the pending line reverses
        // the bill; Sprint 7 will also re-derive totals.
        DB::table('invoice_line_items')->where('session_id', $session->id)->delete();
    }

    /**
     * Resolve the invoice payer columns for this session per the academy's grouping (R-INV-4):
     * exactly one of guardian_id / student_id is set.
     *
     * @return array{0: ?string, 1: ?string} [guardianId, studentId]
     */
    private function payer(object $academy, object $session): array
    {
        if (($academy->invoice_grouping ?? 'PER_GUARDIAN') === 'PER_STUDENT') {
            return [null, (string) $session->student_id];
        }

        $guardianId = DB::table('students')->where('id', $session->student_id)->value('guardian_id');

        return [$guardianId !== null ? (string) $guardianId : null, null];
    }

    /** Find the payer's invoice for the month, opening one if none exists yet (R-INV-1). */
    private function ensureOpenInvoice(object $academy, ?string $guardianId, ?string $studentId, int $year, int $month): string
    {
        $existing = DB::table('invoices')
            ->where('academy_id', $academy->id)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->when($guardianId !== null, fn ($q) => $q->where('guardian_id', $guardianId))
            ->when($studentId !== null, fn ($q) => $q->where('student_id', $studentId))
            ->first();

        if ($existing !== null) {
            return (string) $existing->id;
        }

        $id = (string) Str::uuid();
        DB::table('invoices')->insert([
            'id' => $id,
            'academy_id' => $academy->id,
            'guardian_id' => $guardianId,
            'student_id' => $studentId,
            'period_year' => $year,
            'period_month' => $month,
            'status' => 'OPEN',
            'currency' => $academy->default_currency,
            'subtotal_minor' => 0,
            'total_minor' => 0,
            'public_token' => PublicInvoiceToken::forName($academy->name ?? null),
        ]);

        return $id;
    }
}
