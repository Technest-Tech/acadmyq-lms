<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A student taken out of a monthly group with lessons paid and not taken (Lingo 2026-11-15: "attended
 * 5, 3 left worth 180 — add as the parent's credit, refund it, or keep it"). The private-subscription
 * twin is PackageSettlement; this is the group's, decided in the same step as the removal:
 *
 *   • CREDIT — the charge comes down by what was not used ({@see GroupBilling::leaveQuote}); what was
 *     paid beyond the new amount is freed by the reprice trigger and becomes the family's credit,
 *     which then pays their other open charges. An hours charge also gives back the unused minutes,
 *     so coming back later starts a fresh month instead of re-using lessons already credited.
 *   • REFUND — the same, then the freed money is paid out of a treasury account (an expense under
 *     "رد مبالغ للأسر", drawn on their receipts).
 *   • KEEP — nothing moves; the charge stays as it was.
 *
 * Only an academy kept by receipts (it needs per-line paid amounts).
 */
final class GroupLeaveSettlement
{
    public const MODES = ['CREDIT', 'REFUND', 'KEEP'];

    public function __construct(private readonly Ledger $ledger, private readonly PackageSettlement $packages) {}

    public static function availableFor(string $academyId): bool
    {
        return Ledger::keeps($academyId);
    }

    /**
     * @param  array<string, mixed>  $quote  from GroupBilling::leaveQuote, read before the removal
     * @return array{mode:string, amount_minor:int, refunded_minor:int, currency:string, expense_number:?string}
     */
    public function settle(object $group, string $studentId, string $leftOn, array $quote, string $mode, ?string $cashAccountId, ?string $userId, ?string $role): array
    {
        $out = ['mode' => $mode, 'amount_minor' => 0, 'refunded_minor' => 0, 'currency' => (string) $quote['currency'], 'expense_number' => null];
        if ($mode === 'KEEP' || (int) $quote['unused_minor'] <= 0) {
            Audit::log('class_group.leave_settled', 'class_group', (string) $group->id, (string) $group->academy_id, $userId, $role,
                after: ['student_id' => $studentId, 'mode' => 'KEEP', 'unused_minor' => (int) $quote['unused_minor']]);

            return ['mode' => 'KEEP'] + $out;
        }
        if ($mode === 'REFUND' && ($cashAccountId === null || (int) $quote['refundable_minor'] <= 0)) {
            throw ValidationException::withMessages(['cash_account_id' => ['Nothing paid to give back, or no account chosen. / لا يوجد مدفوع لرده، أو لم تُختر الخزنة.']]);
        }

        $line = DB::table('invoice_line_items')->where('id', $quote['line_id'])->lockForUpdate()->first();
        $cut = min((int) $quote['unused_minor'], (int) $line->amount_minor);
        $amount = (int) $line->amount_minor - $cut;
        $list = $line->list_amount_minor !== null && (int) $line->amount_minor > 0
            ? max($amount, (int) round((int) $line->list_amount_minor * $amount / (int) $line->amount_minor))
            : null;

        // A closed bill comes DOWN only under this escape (the same one a private block's settlement uses).
        DB::statement("select set_config('app.settling_invoice_id', ?, true)", [(string) $line->invoice_id]);
        try {
            DB::table('invoice_line_items')->where('id', $line->id)->update([
                'amount_minor' => $amount,
                'list_amount_minor' => $list,
                'discount_minor' => $list !== null ? $list - $amount : $line->discount_minor,
                'group_minutes' => $line->group_minutes !== null ? max(0, (int) $line->group_minutes - (int) $quote['unused_minutes']) : null,
                'description' => mb_substr((string) $line->description.' — left '.$leftOn.' / غادر', 0, 500),
            ]);
            DB::table('invoices')->where('id', $line->invoice_id)->update([
                'subtotal_minor' => DB::raw("subtotal_minor - {$cut}"),
                'total_minor' => DB::raw("total_minor - {$cut}"),
                'updated_at' => now(),
            ]);
        } finally {
            DB::statement("select set_config('app.settling_invoice_id', '', true)");
        }
        DB::select('select app.ledger_refresh_invoice(?)', [(string) $line->invoice_id]);

        $invoice = DB::table('invoices')->where('id', $line->invoice_id)->first();
        if ($mode === 'REFUND') {
            $expense = $this->packages->refundCredit((string) $group->academy_id, $this->ledger->payerOfInvoice($invoice), (int) $quote['refundable_minor'], (string) $quote['currency'],
                (string) $cashAccountId, 'Left the group '.$group->name.' / غادر المجموعة', $userId, $role);
            $out['refunded_minor'] = (int) $quote['refundable_minor'];
            $out['expense_number'] = $expense['number'];
        }
        // What is left of the credit pays whatever else the family owes.
        $this->ledger->afterLinesChanged((string) $invoice->id);
        $period = Carbon::parse($line->group_period ?? $line->session_date);
        app(GroupPayroll::class)->syncRevenueShare($group, (int) $period->year, (int) $period->month);

        Audit::log('class_group.leave_settled', 'class_group', (string) $group->id, (string) $group->academy_id, $userId, $role,
            before: ['line_id' => (string) $line->id, 'amount_minor' => (int) $line->amount_minor],
            after: ['student_id' => $studentId, 'mode' => $mode, 'amount_minor' => $amount, 'cut_minor' => $cut, 'refunded_minor' => $out['refunded_minor'], 'left_on' => $leftOn]);

        return ['mode' => $mode, 'amount_minor' => $cut] + $out;
    }
}
