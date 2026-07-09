<?php

declare(strict_types=1);

namespace App\Services;

use App\Billing\BillingHook;
use App\Support\Audit;
use App\Support\PublicInvoiceToken;
use App\Support\StudentStatus;
use Illuminate\Database\Eloquent\ModelNotFoundException;
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

        // A trial is a free taster — never billed. Skipping here, BEFORE any invoice is opened,
        // is what stops a TRIAL/TRIAL_BOOKED learner's attended session from spinning up a
        // spurious, subscription-less invoice in the academy's default currency. Once the student
        // converts to REGULAR their real sessions bill under the subscription currency into a
        // single invoice, so the parent never sees the trial split off as a second row (R-BIL-1).
        $studentStatus = DB::table('students')->where('id', $session->student_id)->value('status');
        if (in_array($studentStatus, [StudentStatus::TRIAL, StudentStatus::TRIAL_BOOKED], true)) {
            return;
        }

        $tz = $academy->timezone ?: 'UTC';
        $local = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz);
        $year = (int) $local->year;
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

        // A free-trial lesson is on the house: the student is never charged for it (the academy
        // absorbs it as customer acquisition). The line is still recorded — at zero — so the
        // trial appears on the invoice as "Free trial" rather than vanishing silently.
        $isFreeTrial = $this->isFreeTrial((string) $session->id);
        $subscription = $this->getActiveSubscription((string) $session->student_id);
        $amountMinor = $isFreeTrial
            ? 0
            : ($subscription !== null
                ? $this->resolvePerSessionAmount($subscription, $invoiceId, (string) $session->student_id, (int) $session->duration_minutes)
                : 0);
        $description = $isFreeTrial
            ? 'Free trial — '.$local->format('Y-m-d')
            : $this->buildDescription($session, $academy);
        $sessionDate = $local->format('Y-m-d');

        // insertOrIgnore is the concurrency backstop for the unique (invoice_id, session_id)
        // constraint — even in a race condition a duplicate line cannot be created (R-BIL-1).
        $inserted = DB::table('invoice_line_items')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'academy_id' => $session->academy_id,
            'invoice_id' => $invoiceId,
            'session_id' => $session->id,
            'student_id' => $session->student_id,
            'description' => $description,
            'amount_minor' => $amountMinor,
            'currency' => $currency,
            'session_date' => $sessionDate,
            'created_at' => now(),
        ]);

        if ($inserted) {
            DB::table('invoices')
                ->where('id', $invoiceId)
                ->update([
                    'subtotal_minor' => DB::raw("subtotal_minor + {$amountMinor}"),
                    'total_minor' => DB::raw("subtotal_minor + {$amountMinor}"),
                    'updated_at' => now(),
                ]);

            Audit::log(
                'invoice.line_added',
                'invoice',
                $invoiceId,
                (string) $session->academy_id,
                null,
                'SUPER_ADMIN',
                after: [
                    'session_id' => $session->id,
                    'amount_minor' => $amountMinor,
                    'currency' => $currency,
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

        $invoiceId = (string) $line->invoice_id;
        $amountMinor = (int) $line->amount_minor;
        $academyId = (string) $line->academy_id;

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
                'total_minor' => DB::raw("subtotal_minor - {$amountMinor}"),
                'updated_at' => now(),
            ]);

        Audit::log(
            'invoice.line_removed',
            'invoice',
            $invoiceId,
            $academyId,
            null,
            'SUPER_ADMIN',
            before: [
                'session_id' => $session->id,
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
     * @throws \RuntimeException if total_minor ≠ sum of line items
     * @throws ModelNotFoundException (implicit) if not found
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
                ."total_minor={$invoice->total_minor} but line items sum to {$lineSum}."
            );
        }

        $closedAt = now();

        DB::table('invoices')
            ->where('id', $invoiceId)
            ->update([
                'status' => 'CLOSED',
                'closed_at' => $closedAt,
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
                'status' => 'CLOSED',
                'closed_at' => $closedAt->toIso8601String(),
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
    // Manual invoices (operator-created)
    // -------------------------------------------------------------------------

    /**
     * Create a MANUAL itemized invoice as an OPEN draft (Sprint 9). Unlike AUTO invoices the
     * payer/period are chosen by the operator and the lines are free-form (no session_id).
     * Subtotal/total are the sum of the supplied line amounts.
     *
     * @param  list<array{description: string, amount_minor: int, student_id?: ?string}>  $lines
     * @return string the new invoice UUID
     */
    public function createManualInvoice(
        string $academyId,
        ?string $guardianId,
        ?string $studentId,
        int $year,
        int $month,
        string $currency,
        array $lines,
        string $actorUserId,
        string $actorRole,
    ): string {
        $total = 0;
        foreach ($lines as $line) {
            $total += (int) $line['amount_minor'];
        }

        $invoiceId = (string) Str::uuid();

        DB::table('invoices')->insert([
            'id' => $invoiceId,
            'academy_id' => $academyId,
            'kind' => 'MANUAL',
            'guardian_id' => $guardianId,
            'student_id' => $studentId,
            'period_year' => $year,
            'period_month' => $month,
            'status' => 'OPEN',
            'currency' => $currency,
            'subtotal_minor' => $total,
            'total_minor' => $total,
            'public_token' => PublicInvoiceToken::forAcademyId($academyId),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ($lines as $line) {
            DB::table('invoice_line_items')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'invoice_id' => $invoiceId,
                'session_id' => null,
                'student_id' => $line['student_id'] ?? null,
                'description' => $line['description'],
                'amount_minor' => (int) $line['amount_minor'],
                'currency' => $currency,
                'session_date' => null,
                'created_at' => now(),
            ]);
        }

        Audit::log(
            'invoice.created',
            'invoice',
            $invoiceId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: [
                'kind' => 'MANUAL',
                'total_minor' => $total,
                'currency' => $currency,
                'lines' => count($lines),
            ],
        );

        return $invoiceId;
    }

    /**
     * Quote an advance-payment invoice: the remaining still-billable sessions for a student
     * from the given start date through the end of that month, priced by the student's active
     * subscription. Read-only — used to preview the bill before it is created.
     *
     * @return array{
     *   currency: string,
     *   total_minor: int,
     *   count: int,
     *   price_basis: ?string,
     *   has_subscription: bool,
     *   lines: list<array{session_id: string, session_date: string, description: string, amount_minor: int}>
     * }
     */
    public function advanceQuote(string $studentId, string $startDate): array
    {
        $student = DB::table('students')->where('id', $studentId)->first();
        if ($student === null) {
            throw ValidationException::withMessages([
                'student_id' => ['Student not found. / الطالب غير موجود.'],
            ]);
        }

        $academy = DB::table('academies')->where('id', $student->academy_id)->first();
        $tz = $academy->timezone ?: 'UTC';

        $subscription = $this->getActiveSubscription($studentId);
        $currency = $subscription?->currency ?? (string) $academy->default_currency;

        // Window: [start-of-day(start_date) .. end-of-month] expressed in the academy timezone,
        // converted to UTC for the scheduled_at_utc comparison.
        $start = Carbon::parse($startDate, $tz)->startOfDay();
        $end = $start->copy()->endOfMonth()->endOfDay();

        $sessions = DB::table('sessions')
            ->where('student_id', $studentId)
            ->where('status', 'SCHEDULED')
            ->where('billed', false)
            ->whereBetween('scheduled_at_utc', [$start->utc(), $end->utc()])
            ->orderBy('scheduled_at_utc')
            ->get(['id', 'scheduled_at_utc', 'duration_minutes']);

        $lines = [];
        $total = 0;
        foreach ($sessions as $session) {
            $amount = $subscription !== null
                ? $this->advanceSessionAmount($subscription, (int) $session->duration_minutes)
                : 0;
            $localDate = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz)->format('Y-m-d');
            $lines[] = [
                'session_id' => (string) $session->id,
                'session_date' => $localDate,
                'description' => "Advance — session {$localDate}",
                'amount_minor' => $amount,
            ];
            $total += $amount;
        }

        return [
            'currency' => $currency,
            'total_minor' => $total,
            'count' => count($lines),
            'price_basis' => $subscription?->price_basis,
            'has_subscription' => $subscription !== null,
            'lines' => $lines,
        ];
    }

    /**
     * Create an advance-payment invoice (MANUAL, OPEN) from the authoritative server-side
     * quote. The covered sessions are flagged billed=true so the automatic billing hook never
     * re-bills them when they are later attended (R-BIL-1 double-bill guard).
     *
     * @return array{invoice_id: ?string, count: int} invoice_id is null when nothing is billable.
     */
    public function createAdvanceInvoice(
        string $studentId,
        string $startDate,
        string $actorUserId,
        string $actorRole,
    ): array {
        $quote = $this->advanceQuote($studentId, $startDate);

        if ($quote['count'] === 0) {
            return ['invoice_id' => null, 'count' => 0];
        }

        $student = DB::table('students')->where('id', $studentId)->first();
        $academyId = (string) $student->academy_id;
        $period = Carbon::parse($startDate);
        $invoiceId = (string) Str::uuid();
        $total = (int) $quote['total_minor'];
        $currency = (string) $quote['currency'];

        DB::table('invoices')->insert([
            'id' => $invoiceId,
            'academy_id' => $academyId,
            'kind' => 'MANUAL',
            'guardian_id' => null,
            'student_id' => $studentId,
            'period_year' => (int) $period->year,
            'period_month' => (int) $period->month,
            'status' => 'OPEN',
            'currency' => $currency,
            'subtotal_minor' => $total,
            'total_minor' => $total,
            'public_token' => PublicInvoiceToken::forAcademyId($academyId),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $sessionIds = [];
        foreach ($quote['lines'] as $line) {
            DB::table('invoice_line_items')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'invoice_id' => $invoiceId,
                'session_id' => $line['session_id'],
                'student_id' => $studentId,
                'description' => $line['description'],
                'amount_minor' => (int) $line['amount_minor'],
                'currency' => $currency,
                'session_date' => $line['session_date'],
                'created_at' => now(),
            ]);
            $sessionIds[] = $line['session_id'];
        }

        // Pre-bill the covered sessions so the automatic hook skips them later.
        DB::table('sessions')
            ->whereIn('id', $sessionIds)
            ->update(['billed' => true, 'updated_at' => now()]);

        Audit::log(
            'invoice.created',
            'invoice',
            $invoiceId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: [
                'kind' => 'MANUAL',
                'mode' => 'ADVANCE',
                'total_minor' => $total,
                'currency' => $currency,
                'sessions' => count($sessionIds),
            ],
        );

        return ['invoice_id' => $invoiceId, 'count' => count($sessionIds)];
    }

    /**
     * Per-session amount for an advance quote. Mirrors resolvePerSessionAmount's PER_HOUR /
     * PER_SESSION rules; PER_MONTH is the even per-quota share (no last-session remainder
     * absorption, since an advance quote stands alone rather than completing a month).
     */
    private function advanceSessionAmount(object $subscription, int $durationMinutes): int
    {
        $priceMinor = (int) $subscription->price_minor;

        if ($subscription->price_basis === 'PER_HOUR') {
            return (int) round($priceMinor * $durationMinutes / 60);
        }

        if ($subscription->price_basis === 'PER_MONTH') {
            $perMonth = isset($subscription->sessions_per_month)
                ? (int) $subscription->sessions_per_month
                : 0;

            return $perMonth > 0 ? (int) round($priceMinor / $perMonth) : $priceMinor;
        }

        // PER_SESSION (and any unknown basis) → flat snapshot.
        return $priceMinor;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Resolve the invoice payer AND currency together for this session (§3.6 multi-currency
     * safety). Returns [guardianId|null, studentId|null, currency] — exactly one of the first
     * two is non-null.
     *
     * The invoice currency ALWAYS follows the student's active subscription, so the invoice
     * currency matches the line amounts (which are priced from that subscription). The
     * guardian's stored currency is never used as an override — that previously caused USD
     * lessons to be billed under an EGP invoice.
     *
     * PER_STUDENT: returns [null, studentId, subscriptionCurrency].
     *
     * PER_GUARDIAN: bills the student's parent — returns [guardianId, null, subscriptionCurrency].
     *   Invoices are keyed by (guardian, currency), so a parent whose children are billed in
     *   different currencies receives one invoice per currency — never a per-student invoice —
     *   which still avoids any cross-currency aggregation (R-INV-7, AC-7.12). Only a student
     *   with no parent falls back to a per-student invoice.
     *
     * @return array{0: ?string, 1: ?string, 2: string} [guardianId, studentId, currency]
     */
    private function resolvePayerAndCurrency(object $academy, object $session): array
    {
        $grouping = $academy->invoice_grouping ?? 'PER_GUARDIAN';
        $defaultCurrency = (string) $academy->default_currency;

        // Currency always follows the student's own subscription.
        $sub = $this->getActiveSubscription((string) $session->student_id);
        $currency = $sub?->currency !== null ? (string) $sub->currency : $defaultCurrency;

        if ($grouping === 'PER_STUDENT') {
            return [null, (string) $session->student_id, $currency];
        }

        // PER_GUARDIAN — bill the student's parent.
        $guardianId = DB::table('students')
            ->where('id', $session->student_id)
            ->value('guardian_id');

        if ($guardianId === null) {
            // Defensive: student has no parent → fall back to a per-student invoice.
            return [null, (string) $session->student_id, $currency];
        }

        return [(string) $guardianId, null, $currency];
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
            'id' => $id,
            'academy_id' => $academy->id,
            'guardian_id' => $guardianId,
            'student_id' => $studentId,
            'period_year' => $year,
            'period_month' => $month,
            'status' => 'OPEN',
            'currency' => $currency,
            'subtotal_minor' => 0,
            'total_minor' => 0,
            'public_token' => PublicInvoiceToken::forName($academy->name ?? null),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    /**
     * Determine the amount_minor for this session given the subscription's price_basis.
     *
     * PER_SESSION → subscription.price_minor (straightforward snapshot).
     *
     * PER_HOUR    → subscription.price_minor is the hourly rate; the line bills the rate
     *               pro-rated to the session's actual duration:
     *
     *                 amount = round(price_minor × duration_minutes ÷ 60)
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
        int $durationMinutes = 0,
    ): int {
        $priceMinor = (int) $subscription->price_minor;

        if ($subscription->price_basis === 'PER_HOUR') {
            return (int) round($priceMinor * $durationMinutes / 60);
        }

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
        $tz = $academy->timezone ?: 'UTC';
        $localDate = Carbon::parse($session->scheduled_at_utc)->setTimezone($tz)->format('Y-m-d');

        // A charged cancellation (the academy chose to bill a late-cancel fee) reads as a cancelled
        // lesson on the parent's bill, with the cancellation reason as the line's explanation —
        // never the session report (a cancelled lesson has none).
        $status = (string) ($session->status ?? '');
        if (in_array($status, ['CANCELLED_BY_TEACHER', 'CANCELLED_BY_STUDENT'], true)) {
            $base = "Cancelled lesson {$localDate}";
            $reason = isset($session->status_reason) ? trim((string) $session->status_reason) : '';

            return $reason !== '' ? $base.' — '.$reason : $base;
        }

        // A FREE lesson only reaches billing when the academy chose to charge it anyway (bill
        // override) — surface the reason the owner gave in the billing popup, as for a cancellation.
        if ($status === 'FREE') {
            $base = "Session {$localDate}";
            $reason = isset($session->status_reason) ? trim((string) $session->status_reason) : '';

            return $reason !== '' ? $base.' — '.$reason : $base;
        }

        $base = "Session {$localDate}";

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

        return $base.' — '.(string) $fieldValue;
    }

    /**
     * Re-derive a session's invoice line from current truth — used when the free-trial flag is
     * toggled AFTER attendance was already recorded (the UI records attendance first, then saves
     * the report carrying `is_free_trial`). Remove + re-add reuses all the normal pricing logic
     * (including the PER_MONTH remainder, which recounts cleanly once the old line is gone) and
     * picks up the now-current trial flag via {@see onSessionBillable}. No-op if the session was
     * never billed (the hook will price it correctly when attendance is eventually recorded).
     *
     * @throws ValidationException if the carrying invoice is already closed (immutability).
     */
    public function repriceFreeTrial(object $session): void
    {
        $exists = DB::table('invoice_line_items')->where('session_id', $session->id)->exists();
        if (! $exists) {
            return;
        }

        $this->onSessionUnbilled($session);
        $this->onSessionBillable($session);
    }

    /**
     * Whether the session's report flags it as a free trial (reserved JSONB key written by the
     * report endpoint). A trial is billed to nobody — zero on both the student invoice and the
     * teacher payout.
     */
    private function isFreeTrial(string $sessionId): bool
    {
        $values = DB::table('session_reports')->where('session_id', $sessionId)->value('values');
        if ($values === null) {
            return false;
        }

        $decoded = is_string($values) ? json_decode($values, true) : (array) $values;

        return (bool) ($decoded['is_free_trial'] ?? false);
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
