<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use App\Support\LessonCount;
use App\Support\PublicInvoiceToken;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The ONE bill line a centre subscription is (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md,
 * rule 2): raised on the family's bill when the block is sold, re-issued IN PLACE when it is edited.
 * The line is remembered by id, never found by what it says. A lower amount hands the excess
 * allocations back to the receipts (the ledger's own `trg_invoice_line_repriced`); a higher one
 * leaves the difference due. Only {@see CentreSubscriptions} calls this.
 */
final class SubscriptionBilling
{
    public function __construct(private readonly Invoicing $invoicing, private readonly PayerDiscounts $discounts, private readonly Ledger $ledger) {}

    /** Raise the block's bill: one MANUAL invoice addressed to the payer, one line, priced after any standing discount. */
    public function raise(object $sub, object $academy, ?string $actorUserId, ?string $actorRole): string
    {
        $academyId = (string) $sub->academy_id;
        [$guardianId, $payerStudentId] = $this->invoicing->payerOf($academy, (string) $sub->student_id);
        $period = Carbon::parse((string) $sub->starts_on);
        $priced = $this->discounts->apply($academyId, (string) $sub->student_id, PayerDiscounts::SCOPE_PRIVATE, null, (int) $sub->price_minor, $period->toDateString(), $sub->teacher_id !== null ? (string) $sub->teacher_id : null);

        $invoiceId = (string) Str::uuid();
        DB::table('invoices')->insert([
            'id' => $invoiceId, 'academy_id' => $academyId, 'kind' => 'MANUAL', 'guardian_id' => $guardianId, 'student_id' => $payerStudentId,
            'period_year' => (int) $period->year, 'period_month' => (int) $period->month, 'status' => 'OPEN', 'currency' => (string) $sub->currency,
            'subtotal_minor' => $priced['amount_minor'], 'total_minor' => $priced['amount_minor'],
            'public_token' => PublicInvoiceToken::forAcademyId($academyId), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $lineId = (string) Str::uuid();
        DB::table('invoice_line_items')->insert([
            'id' => $lineId, 'academy_id' => $academyId, 'invoice_id' => $invoiceId, 'session_id' => null, 'student_id' => (string) $sub->student_id,
            'description' => self::description($sub), 'amount_minor' => $priced['amount_minor'], 'list_amount_minor' => $priced['list_amount_minor'],
            'discount_minor' => $priced['discount_minor'], 'discount_label' => $priced['discount_label'], 'currency' => (string) $sub->currency,
            'session_date' => $period->toDateString(), 'created_at' => now(),
        ]);
        DB::table('centre_subscriptions')->where('id', $sub->id)->update(['invoice_id' => $invoiceId, 'invoice_line_id' => $lineId, 'updated_at' => now()]);
        $this->ledger->afterLinesChanged($invoiceId);
        Audit::log('invoice.created', 'invoice', $invoiceId, $academyId, $actorUserId, $actorRole,
            after: ['kind' => 'MANUAL', 'mode' => 'SUBSCRIPTION', 'total_minor' => $priced['amount_minor'], 'currency' => (string) $sub->currency]);

        return $invoiceId;
    }

    /**
     * Re-issue the block's line in place: new words always, a new amount when `$repriced`.
     *
     * @return array{credited_minor: int, due_minor: int}
     */
    public function reissue(object $sub, bool $repriced, ?string $actorUserId, ?string $actorRole): array
    {
        $line = DB::table('invoice_line_items')->where('id', $sub->invoice_line_id)->first();
        $invoice = DB::table('invoices')->where('id', $sub->invoice_id)->first();
        if ($line === null || $invoice === null || $invoice->status === 'VOID') {
            return ['credited_minor' => 0, 'due_minor' => 0];
        }
        $fields = ['description' => self::description($sub)];
        if ($repriced) {
            // The same price is the same charge (its discount included); a new one is priced afresh.
            $fields += array_intersect_key(
                $this->discounts->apply((string) $sub->academy_id, (string) $sub->student_id, PayerDiscounts::SCOPE_PRIVATE, null, (int) $sub->price_minor, (string) $line->session_date, $sub->teacher_id !== null ? (string) $sub->teacher_id : null),
                array_flip(['amount_minor', 'list_amount_minor', 'discount_minor', 'discount_label']),
            );
        }
        $paidBefore = $this->allocatedTo((string) $line->id);
        $total = (int) DB::table('invoice_line_items')->where('invoice_id', $invoice->id)->where('id', '<>', $line->id)->sum('amount_minor') + (int) ($fields['amount_minor'] ?? $line->amount_minor);
        // A centre's bills never close; should one be closed all the same, it may only come down.
        if ($invoice->status !== 'OPEN' && $total > (int) $invoice->total_minor) {
            throw ValidationException::withMessages(['price_minor' => ['This bill is closed: a dearer subscription cannot be put on it. / هذه الفاتورة مقفلة: لا يمكن رفع قيمة الاشتراك عليها.']]);
        }
        DB::statement("select set_config('app.settling_invoice_id', ?, true)", [(string) $invoice->id]);
        try {
            DB::table('invoice_line_items')->where('id', $line->id)->update($fields);
            DB::table('invoices')->where('id', $invoice->id)->update(['subtotal_minor' => $total, 'total_minor' => $total, 'updated_at' => now()]);
        } finally {
            DB::statement("select set_config('app.settling_invoice_id', '', true)");
        }
        if (Ledger::keeps((string) $sub->academy_id)) {
            DB::select('select app.ledger_refresh_invoice(?)', [(string) $invoice->id]);
        }
        $this->ledger->afterLinesChanged((string) $invoice->id);
        Audit::log('invoice.updated', 'invoice', (string) $invoice->id, (string) $sub->academy_id, $actorUserId, $actorRole,
            after: ['total_minor' => $total, 'mode' => 'SUBSCRIPTION_EDITED'], before: ['total_minor' => (int) $invoice->total_minor]);

        return ['credited_minor' => max(0, $paidBefore - $this->allocatedTo((string) $line->id)), 'due_minor' => $this->dueOn((string) $invoice->id)];
    }

    /** What the bill line says — families read it, so in their words. */
    public static function description(object $sub): string
    {
        $subject = $sub->course !== null && trim((string) $sub->course) !== '' ? ' ('.trim((string) $sub->course).')' : '';

        return 'اشتراك: '.$sub->label.$subject.' — '.LessonCount::ar((int) $sub->lessons_sold);
    }

    public function allocatedTo(string $lineId): int
    {
        return (int) DB::table('receipt_allocations')->where('invoice_line_id', $lineId)->sum('amount_minor');
    }

    /** What is still owed on a bill (nothing on a voided one). */
    public function dueOn(?string $invoiceId): int
    {
        if ($invoiceId === null) {
            return 0;
        }
        $i = DB::table('invoices')->where('id', $invoiceId)->first(['status', 'total_minor', 'amount_paid_minor']);

        return $i === null || $i->status === 'VOID' ? 0 : max(0, (int) $i->total_minor - (int) $i->amount_paid_minor);
    }
}
