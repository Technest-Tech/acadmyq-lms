<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use App\Support\CentreBooks;
use App\Support\LessonCount;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * What becomes of the money a centre subscription did not use — {@see PackageSettlement}'s rules,
 * ported to blocks counted in lessons (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md, rule 2):
 *
 *   CREDIT  the block's line comes down to what was used (its agreed price after any discount ×
 *           used / sold); the ledger frees what was paid beyond it as the family's credit.
 *   REFUND  the same, and that credit is paid back now out of a treasury account.
 *   KEEP    the academy keeps it — the decision and why are recorded, nothing moves.
 *
 * Only what was actually PAID beyond what was used ever comes back. Only where the books are kept by
 * receipts (CentreBooks). The line is found by its id, never by what it says.
 */
final class SubscriptionSettlement
{
    public const MODES = ['CREDIT', 'REFUND', 'KEEP'];

    public function __construct(private readonly Ledger $ledger, private readonly PackageSettlement $refunds, private readonly Treasury $treasury) {}

    /**
     * Where a block stands: lessons left, what it was worth, what was paid, what would come back.
     * Null when there is nothing to work on (no bill line, or books not kept by receipts).
     *
     * @return array{settlement: ?string, lessons_sold: int, lessons_used: int, unused_lessons: int, price_minor: int, used_value_minor: int, paid_minor: int, owed_back_minor: int, currency: string, can_refund: bool}|null
     */
    public function preview(object $sub): ?array
    {
        if ($sub->invoice_line_id === null || ! CentreBooks::enabledFor((string) $sub->academy_id)) {
            return null;
        }
        $line = $this->line($sub);
        if ($line === null) {
            return null;
        }

        $sold = max(1, (int) $sub->lessons_sold);
        $used = min($sold, $this->used((string) $sub->id));
        // The price agreed for the block — a line let go down to what was paid still remembers it.
        $agreed = $line->list_amount_minor !== null
            ? (int) $line->list_amount_minor - (int) $line->discount_minor
            : (int) $line->amount_minor + (int) ($line->cancelled_minor ?? 0);
        $usedValue = min($agreed, (int) round($agreed * $used / $sold));
        $open = $sub->settlement === null || $sub->settlement === 'PENDING';
        $paid = (int) $line->allocated;

        return [
            'settlement' => $sub->settlement,
            'lessons_sold' => $sold,
            'lessons_used' => $used,
            'unused_lessons' => $sold - $used,
            'price_minor' => $agreed,
            'used_value_minor' => $usedValue,
            'paid_minor' => $paid,
            'owed_back_minor' => $open ? max(0, $paid - $usedValue) : 0,
            'currency' => (string) $sub->currency,
            'can_refund' => $open && $paid - $usedValue > 0,
        ];
    }

    /** A block just closed with lessons left on a paid bill: someone has to decide what becomes of them. */
    public function markIfOwed(string $subscriptionId): void
    {
        $sub = DB::table('centre_subscriptions')->where('id', $subscriptionId)->first();
        if ($sub === null || in_array($sub->status, ['OPEN', 'FINISHED'], true) || $sub->settlement !== null) {
            return;
        }
        $preview = $this->preview($sub);
        if ($preview !== null && $preview['unused_lessons'] > 0 && $preview['owed_back_minor'] > 0) {
            DB::table('centre_subscriptions')->where('id', $subscriptionId)->update(['settlement' => 'PENDING', 'updated_at' => now()]);
        }
    }

    /**
     * Settle a closed block. `$refund` names where the money leaves: `cash_account_id`, or the
     * `method` whose receipts land in one account (the treasury's method → account map).
     *
     * @param  array{method?: ?string, cash_account_id?: ?string, reference?: ?string, note?: ?string}|null  $refund
     * @return array{mode: string, amount_minor: int, currency: string, expense_id: ?string, expense_number: ?string}
     */
    public function settle(string $subscriptionId, string $mode, ?array $refund, ?string $userId, ?string $role): array
    {
        // Its own savepoint: a refused refund (a closed day) must not leave the bill brought down.
        return DB::transaction(function () use ($subscriptionId, $mode, $refund, $userId, $role): array {
            $sub = DB::table('centre_subscriptions')->where('id', $subscriptionId)->lockForUpdate()->first();
            if ($sub === null) {
                abort(404, 'Subscription not found.');
            }
            if (in_array($sub->status, ['OPEN', 'FINISHED'], true)) {
                throw ValidationException::withMessages(['subscription' => ['End the subscription first. / أنهِ الاشتراك أولًا.']]);
            }
            if (! in_array($sub->settlement, [null, 'PENDING'], true)) {
                throw ValidationException::withMessages(['subscription' => ['This subscription is already settled. / تمت تسوية هذا الاشتراك بالفعل.']]);
            }
            $preview = $this->preview($sub);
            if ($preview === null || $preview['owed_back_minor'] <= 0) {
                throw ValidationException::withMessages(['subscription' => ['Nothing was paid beyond what was used. / لم يُدفع شيء زيادة عن المستخدم.']]);
            }
            $amount = $preview['owed_back_minor'];
            $currency = $preview['currency'];
            $note = isset($refund['note']) && trim((string) $refund['note']) !== '' ? trim((string) $refund['note']) : null;
            $expense = null;

            if ($mode !== 'KEEP') {
                $line = $this->line($sub);
                $this->bringDown($sub, $line, $preview);
                $invoice = DB::table('invoices')->where('id', $line->invoice_id)->first();
                if ($mode === 'REFUND') {
                    $accountId = $this->refundAccount((string) $sub->academy_id, $refund ?? [], $currency);
                    $description = $note ?? 'Unused subscription: '.$sub->label.' / باقي اشتراك لم يُستخدم';
                    if (isset($refund['reference']) && trim((string) $refund['reference']) !== '') {
                        $description .= ' ('.trim((string) $refund['reference']).')';
                    }
                    $expense = $this->refunds->refundCredit((string) $sub->academy_id, $this->ledger->payerOfInvoice($invoice), $amount, $currency, $accountId, $description, $userId, $role);
                }
                // What is left of the credit pays whatever else the family owes.
                $this->ledger->afterLinesChanged((string) $invoice->id);
            }

            DB::table('centre_subscriptions')->where('id', $subscriptionId)->update([
                'settlement' => $mode,
                'settled_minor' => $amount,
                'settled_at' => now(),
                'settled_by' => $userId,
                'settle_note' => $note,
                'settle_expense_id' => $expense['expense_id'] ?? null,
                'updated_at' => now(),
            ]);
            Audit::log('centre_subscription.settled', 'centre_subscription', $subscriptionId, (string) $sub->academy_id, $userId, $role,
                before: ['settlement' => $sub->settlement, 'paid_minor' => $preview['paid_minor'], 'used_value_minor' => $preview['used_value_minor']],
                after: ['settlement' => $mode, 'amount_minor' => $amount, 'currency' => $currency, 'note' => $note, 'expense_id' => $expense['expense_id'] ?? null]);

            return ['mode' => $mode, 'amount_minor' => $amount, 'currency' => $currency,
                'expense_id' => $expense['expense_id'] ?? null, 'expense_number' => $expense['number'] ?? null];
        });
    }

    /**
     * The family's closed blocks still waiting on a decision — the children who left included.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function pendingFor(string $guardianId): Collection
    {
        return DB::table('centre_subscriptions as cs')
            ->join('students as s', 's.id', '=', 'cs.student_id')
            ->where('s.guardian_id', $guardianId)
            ->where('cs.settlement', 'PENDING')
            ->orderBy('cs.closed_at')
            ->get(['cs.*', 's.full_name as student_name'])
            ->map(fn ($cs) => ($preview = $this->preview($cs)) !== null && $preview['owed_back_minor'] > 0
                ? ['kind' => 'SUBSCRIPTION', 'subscription_id' => (string) $cs->id, 'id' => (string) $cs->id,
                    'student_id' => (string) $cs->student_id, 'student_name' => (string) $cs->student_name,
                    'label' => (string) $cs->label, 'closed_on' => $cs->closed_at !== null ? Carbon::parse($cs->closed_at)->format('Y-m-d') : null] + $preview
                : null)
            ->filter()
            ->values();
    }

    /** The block's line comes down to what was used, and its bill with it — closed or not. */
    private function bringDown(object $sub, object $line, array $preview): void
    {
        $usedValue = $preview['used_value_minor'];
        $cut = (int) $line->amount_minor - $usedValue;
        if ($cut <= 0) {
            return;
        }
        $sold = $preview['lessons_sold'];
        $list = $line->list_amount_minor !== null ? (int) round((int) $line->list_amount_minor * $preview['lessons_used'] / $sold) : null;

        DB::statement("select set_config('app.settling_invoice_id', ?, true)", [(string) $line->invoice_id]);
        try {
            DB::table('invoice_line_items')->where('id', $line->id)->update([
                'amount_minor' => $usedValue,
                'list_amount_minor' => $list !== null ? max($list, $usedValue) : null,
                'discount_minor' => $list !== null ? max($list, $usedValue) - $usedValue : $line->discount_minor,
                'description' => $line->description.' — '.LessonCount::ar($preview['lessons_used']).' used',
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
    }

    /** @param  array{method?: ?string, cash_account_id?: ?string}  $refund */
    private function refundAccount(string $academyId, array $refund, string $currency): string
    {
        $accountId = isset($refund['cash_account_id']) && $refund['cash_account_id'] !== null ? (string) $refund['cash_account_id'] : null;
        if ($accountId === null && isset($refund['method']) && $refund['method'] !== null) {
            $accountId = $this->treasury->accountForReceipt($academyId, strtoupper((string) $refund['method']), $currency);
        }
        if ($accountId === null) {
            throw ValidationException::withMessages(['refund' => ['Choose the account the money is paid from. / اختر الخزنة التي يُصرف منها المبلغ.']]);
        }

        return $accountId;
    }

    private function used(string $subscriptionId): int
    {
        return (int) DB::table('centre_subscription_lessons')->where('subscription_id', $subscriptionId)->count();
    }

    /** The block's own line, with what receipts cover of it. */
    private function line(object $sub): ?object
    {
        $allocated = DB::table('receipt_allocations')->selectRaw('invoice_line_id, sum(amount_minor) as allocated')->groupBy('invoice_line_id');

        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoinSub($allocated, 'a', 'a.invoice_line_id', '=', 'li.id')
            ->where('li.id', $sub->invoice_line_id)
            ->where('i.status', '<>', 'VOID')
            ->first(['li.*', DB::raw('coalesce(a.allocated, 0) as allocated')]);
    }
}
