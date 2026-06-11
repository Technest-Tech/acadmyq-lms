<?php

declare(strict_types=1);

namespace App\Services;

use App\Billing\BillingHook;
use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Sprint 7 real billing implementation (replaces the MVP InvoiceBillingHook zero-amount
 * placeholder). Snapshots the subscription price at billing time (R-INV-3), handles
 * PER_SESSION and PER_MONTH price bases with remainder absorption on the last session of
 * the month, multi-currency safety (§3.6), and maintains invoice subtotal/total correctly.
 *
 * Idempotency contract: the caller (AttendanceService) guards via `sessions.billed`; this
 * service also uses `insertOrIgnore` on the unique `(invoice_id, session_id)` constraint as
 * a concurrency backstop so a duplicate line can never be created (R-BIL-1).
 *
 * All writes run inside the caller's tenant transaction (GUCs already set), so every DB
 * write is RLS-scoped to the session's academy automatically.
 */
final class Invoicing implements BillingHook
{
    // -------------------------------------------------------------------------
    // BillingHook
    // -------------------------------------------------------------------------

    /**
     * A session became billable → snapshot the price and ensure exactly one line item exists.
     */
    public function onSessionBillable(object $session): void
    {
        $academy = DB::table('academies')->where('id', $session->academy_id)->first();
        if ($academy === null) {
            return;
        }

        $tz    = $academy->timezone ?: 'UTC';
        $local = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz);
        $year  = (int) $local->year;
        $month = (int) $local->month;

        [$guardianId, $studentId, $currency] = $this->resolvePayerAndCurrency($academy, $session);
        $invoiceId = $this->ensureOpenInvoice($academy, $guardianId, $studentId, $year, $month, $currency);

        // Idempotency: if a line already exists for this session, do nothing.
        $exists = DB::table('invoice_line_items')
            ->where('invoice_id', $invoiceId)
            ->where('session_id', $session->id)
            ->exists();

        if ($exists) {
            return;
        }

        $subscription  = $this->getActiveSubscription((string) $session->student_id);
        $amountMinor   = $subscription !== null
            ? $this->resolvePerSessionAmount($subscription, $invoiceId, (string) $session->student_id)
            : 0;
        $description   = $this->buildDescription($session, $academy);
        $sessionDate   = $local->format('Y-m-d');

        // insertOrIgnore is the concurrency backstop for the unique (invoice_id, session_id)
        // constraint — even in a race condition a duplicate line cannot be created (R-BIL-1).
        $inserted = DB::table('invoice_line_items')->insertOrIgnore([
            'id'           => (string) Str::uuid(),
            'academy_id'   => $session->academy_id,
            'invoice_id'   => $invoiceId,
            'session_id'   => $session->id,
            'student_id'   => $session->student_id,
            'description'  => $description,
            'amount_minor' => $amountMinor,
            'currency'     => $currency,
            'session_date' => $sessionDate,
            'created_at'   => now(),
        ]);

        if ($inserted) {
            DB::table('invoices')
                ->where('id', $invoiceId)
                ->update([
                    'subtotal_minor' => DB::raw("subtotal_minor + {$amountMinor}"),
                    'total_minor'    => DB::raw("subtotal_minor + {$amountMinor}"),
                    'updated_at'     => now(),
                ]);

            Audit::log(
                'invoice.line_added',
                'invoice',
                $invoiceId,
                (string) $session->academy_id,
                null,
                'SUPER_ADMIN',
                after: [
                    'session_id'   => $session->id,
                    'amount_minor' => $amountMinor,
                    'currency'     => $currency,
                ],
            );
        }
    }

    /**
     * A session is no longer billable (corrected before the invoice closed) → remove its
     * pending line item and reverse the invoice total.
     */
    public function onSessionUnbilled(object $session): void
    {
        $line = DB::table('invoice_line_items')
            ->where('session_id', $session->id)
            ->first();

        if ($line === null) {
            return; // Already gone — idempotent.
        }

        $invoiceId   = (string) $line->invoice_id;
        $amountMinor = (int) $line->amount_minor;
        $academyId   = (string) $line->academy_id;

        $invoice = DB::table('invoices')->where('id', $invoiceId)->first();

        if ($invoice !== null && $invoice->status !== 'OPEN') {
            throw ValidationException::withMessages([
                'invoice' => [
                    'Cannot un-bill: invoice is already closed. / لا يمكن إلغاء الفوترة: الفاتورة مُقفلة بالفعل.',
                ],
            ]);
        }

        DB::table('invoice_line_items')->where('id', $line->id)->delete();

        DB::table('invoices')
            ->where('id', $invoiceId)
            ->update([
                'subtotal_minor' => DB::raw("subtotal_minor - {$amountMinor}"),
                'total_minor'    => DB::raw("subtotal_minor - {$amountMinor}"),
                'updated_at'     => now(),
            ]);

        Audit::log(
            'invoice.line_removed',
            'invoice',
            $invoiceId,
            $academyId,
            null,
            'SUPER_ADMIN',
            before: [
                'session_id'   => $session->id,
                'amount_minor' => $amountMinor,
            ],
        );
    }

    // -------------------------------------------------------------------------
    // Public management operations
    // -------------------------------------------------------------------------

    /**
     * Close a single OPEN invoice, verifying its total integrity first.
     *
     * @throws \RuntimeException          if total_minor ≠ sum of line items
     * @throws \Illuminate\Database\Eloquent\ModelNotFoundException (implicit) if not found
     */
    public function closeInvoice(
        string $invoiceId,
        string $academyId,
        string $actorUserId,
        string $actorRole,
    ): void {
        $invoice = DB::table('invoices')
            ->where('id', $invoiceId)
            ->where('academy_id', $academyId)
            ->first();

        if ($invoice === null) {
            return;
        }

        // Idempotent — already closed or paid.
        if (in_array($invoice->status, ['CLOSED', 'PAID'], true)) {
            return;
        }

        // Integrity check: total_minor must equal the sum of all line items.
        $lineSum = (int) DB::table('invoice_line_items')
            ->where('invoice_id', $invoiceId)
            ->sum('amount_minor');

        if ((int) $invoice->total_minor !== $lineSum) {
            throw new \RuntimeException(
                "Invoice {$invoiceId} integrity failure: "
                . "total_minor={$invoice->total_minor} but line items sum to {$lineSum}."
            );
        }

        $closedAt = now();

        DB::table('invoices')
            ->where('id', $invoiceId)
            ->update([
                'status'     => 'CLOSED',
                'closed_at'  => $closedAt,
                'updated_at' => $closedAt,
            ]);

        Audit::log(
            'invoice.closed',
            'invoice',
            $invoiceId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: [
                'status'      => 'CLOSED',
                'closed_at'   => $closedAt->toIso8601String(),
                'total_minor' => (int) $invoice->total_minor,
            ],
        );
    }

    /**
     * Close all OPEN invoices for an academy in the given period.
     *
     * @return int number of invoices actually closed
     */
    public function closePeriodInvoices(
        string $academyId,
        int $year,
        int $month,
        string $actorUserId,
        string $actorRole,
    ): int {
        $invoices = DB::table('invoices')
            ->where('academy_id', $academyId)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->where('status', 'OPEN')
            ->get(['id']);

        $closed = 0;
        foreach ($invoices as $invoice) {
            $this->closeInvoice((string) $invoice->id, $academyId, $actorUserId, $actorRole);
            $closed++;
        }

        return $closed;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Resolve the invoice payer AND currency together for this session (§3.6 multi-currency
     * safety). Returns [guardianId|null, studentId|null, currency] — exactly one of the first
     * two is non-null.
     *
     * PER_STUDENT: always returns [null, studentId, subscriptionCurrency].
     *
     * PER_GUARDIAN: if all the guardian's students share one currency, returns
     *   [guardianId, null, guardianCurrency]. If they differ (mixed currencies), falls back
     *   to [null, studentId, studentCurrency] so each student gets their own per-student
     *   invoice — avoiding any cross-currency aggregation (R-INV-7, AC-7.12, TC-7.30).
     *
     * @return array{0: ?string, 1: ?string, 2: string} [guardianId, studentId, currency]
     */
    private function resolvePayerAndCurrency(object $academy, object $session): array
    {
        $grouping        = $academy->invoice_grouping ?? 'PER_GUARDIAN';
        $defaultCurrency = (string) $academy->default_currency;

        if ($grouping === 'PER_STUDENT') {
            $sub = $this->getActiveSubscription((string) $session->student_id);
            return [null, (string) $session->student_id, $sub?->currency ?? $defaultCurrency];
        }

        // PER_GUARDIAN — look up the student's guardian.
        $guardianId = DB::table('students')
            ->where('id', $session->student_id)
            ->value('guardian_id');

        if ($guardianId === null) {
            // Defensive: student has no guardian → fall back to per-student.
            $sub = $this->getActiveSubscription((string) $session->student_id);
            return [null, (string) $session->student_id, $sub?->currency ?? $defaultCurrency];
        }

        $guardianId = (string) $guardianId;

        // Collect the distinct currencies of all active subscriptions under this guardian.
        $studentIds = DB::table('students')
            ->where('guardian_id', $guardianId)
            ->whereNull('deleted_at')
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->all();

        $currencies = DB::table('subscriptions')
            ->whereIn('student_id', $studentIds)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->distinct()
            ->pluck('currency')
            ->map(fn ($c) => (string) $c)
            ->unique()
            ->values()
            ->all();

        if (count($currencies) === 1) {
            // All students agree on one currency — aggregate under the guardian invoice.
            $guardianCurrency = DB::table('guardians')
                ->where('id', $guardianId)
                ->value('currency');
            $currency = $guardianCurrency !== null ? (string) $guardianCurrency : $currencies[0];
            return [$guardianId, null, $currency];
        }

        // Mixed currencies — fall back to per-student for THIS student to avoid cross-currency
        // aggregation. Each student ends up on their own invoice keyed by student_id.
        $sub = $this->getActiveSubscription((string) $session->student_id);
        return [null, (string) $session->student_id, $sub?->currency ?? $defaultCurrency];
    }

    /**
     * Find or open the OPEN monthly invoice for the given payer/period/currency (R-INV-1).
     *
     * @return string the invoice UUID
     */
    private function ensureOpenInvoice(
        object $academy,
        ?string $guardianId,
        ?string $studentId,
        int $year,
        int $month,
        string $currency,
    ): string {
        $existing = DB::table('invoices')
            ->where('academy_id', $academy->id)
            ->where('period_year', $year)
            ->where('period_month', $month)
            ->where('currency', $currency)
            ->when($guardianId !== null, fn ($q) => $q->where('guardian_id', $guardianId))
            ->when($studentId !== null, fn ($q) => $q->where('student_id', $studentId))
            ->first();

        if ($existing !== null) {
            return (string) $existing->id;
        }

        $id = (string) Str::uuid();

        DB::table('invoices')->insert([
            'id'             => $id,
            'academy_id'     => $academy->id,
            'guardian_id'    => $guardianId,
            'student_id'     => $studentId,
            'period_year'    => $year,
            'period_month'   => $month,
            'status'         => 'OPEN',
            'currency'       => $currency,
            'subtotal_minor' => 0,
            'total_minor'    => 0,
            'public_token'   => Str::random(48),
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        return $id;
    }

    /**
     * Determine the amount_minor for this session given the subscription's price_basis.
     *
     * PER_SESSION → subscription.price_minor (straightforward snapshot).
     *
     * PER_MONTH   → divide evenly across the month's quota; the LAST session of the month
     *               absorbs the integer-division remainder so that the sum of all per-session
     *               amounts always equals price_minor exactly:
     *
     *                 floor = price_minor ÷ sessions_per_month   (integer division)
     *                 last  = price_minor − (floor × (sessions_per_month − 1))
     *
     *               "Last" is detected by checking how many lines already exist for this
     *               student on this invoice — if count + 1 == sessions_per_month, this is
     *               the last slot.
     *
     *               If sessions_per_month is null or 0, treat as PER_SESSION.
     */
    private function resolvePerSessionAmount(
        object $subscription,
        string $invoiceId,
        string $studentId,
    ): int {
        $priceMinor = (int) $subscription->price_minor;

        if ($subscription->price_basis !== 'PER_MONTH') {
            return $priceMinor;
        }

        $sessionsPerMonth = isset($subscription->sessions_per_month)
            ? (int) $subscription->sessions_per_month
            : 0;

        if ($sessionsPerMonth <= 0) {
            // Treat as PER_SESSION when quota is unset.
            return $priceMinor;
        }

        $perSessionFloor = intdiv($priceMinor, $sessionsPerMonth);

        // Count how many lines already exist for this student on this invoice.
        $alreadyBilled = (int) DB::table('invoice_line_items')
            ->where('invoice_id', $invoiceId)
            ->where('student_id', $studentId)
            ->count();

        // This will be line number ($alreadyBilled + 1). If it equals sessions_per_month it is
        // the last session → absorb the remainder.
        if ($alreadyBilled + 1 >= $sessionsPerMonth) {
            // Last (or over-quota) session: pays whatever is left of price_minor.
            return $priceMinor - ($perSessionFloor * $alreadyBilled);
        }

        return $perSessionFloor;
    }

    /**
     * Build the human-readable line item description.
     *
     * Format: "Session YYYY-MM-DD[ — <first text report value>]"
     *
     * If the session has an associated report, the first TEXT-type field value (ordered by
     * report_field_definitions.sort_order) is appended after an em-dash.
     */
    private function buildDescription(object $session, object $academy): string
    {
        $tz        = $academy->timezone ?: 'UTC';
        $localDate = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz)->format('Y-m-d');
        $base      = "Session {$localDate}";

        // Look up the session report and fetch the first text field value.
        $report = DB::table('session_reports')
            ->where('session_id', $session->id)
            ->first(['values']);

        if ($report === null) {
            return $base;
        }

        $values = is_string($report->values)
            ? json_decode($report->values, true)
            : (array) $report->values;

        if (empty($values)) {
            return $base;
        }

        // Find the TEXT-type field with the lowest sort_order whose key exists in the values map.
        $textField = DB::table('report_field_definitions')
            ->where('academy_id', $session->academy_id)
            ->where('field_type', 'TEXT')
            ->where('is_active', true)
            ->whereIn('key', array_keys($values))
            ->orderBy('sort_order')
            ->first(['key']);

        if ($textField === null) {
            return $base;
        }

        $fieldValue = $values[$textField->key] ?? null;
        if ($fieldValue === null || $fieldValue === '') {
            return $base;
        }

        return $base . ' — ' . (string) $fieldValue;
    }

    /**
     * Return the student's current ACTIVE subscription, or null if none exists.
     */
    private function getActiveSubscription(string $studentId): ?object
    {
        return DB::table('subscriptions')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->orderByDesc('start_date')
            ->first();
    }
}
