<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use App\Support\Entitlement;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Receipts — money in as numbered documents (docs/groups/01-ACCOUNTING.md, phase F1).
 *
 * A RECEIPT is money that changed hands: who paid, how much, by which method, on which day, and who
 * took it. Its ALLOCATIONS say which invoice lines that money covers, so every line is exactly paid,
 * part-paid or unpaid, and whatever a receipt does not cover is the payer's CREDIT — applied to their
 * next charges automatically (a parent who pays two months ahead is simply covered when they bill).
 *
 * The invoice's own payment columns become a cache of the allocations, kept by the database
 * (`app.ledger_refresh_invoice`, fired by every allocation change): `amount_paid_minor` is the sum,
 * and once the invoice is closed its status is CLOSED / PARTIALLY_PAID / PAID by that sum. A running
 * month's invoice stays OPEN however much is paid on it, so the rest of the month still bills.
 *
 * Nothing is edited after the fact: a wrong receipt is VOIDED with a reason (its number stays
 * taken) and its money goes back to unpaid. Allocations are the current picture; the receipts and
 * the audit log are the history.
 *
 * Only for an academy with the `accounting` feature (opt-in, FeatureCatalog::OPT_IN_CAPABILITIES).
 * The academy is ADOPTED once — its existing payments become receipts — and from then on its
 * `academy_ledgers` row marks it as kept by its receipts. Every other academy keeps the
 * classic "mark paid" untouched. Runs inside the caller's tenant transaction.
 */
final class Ledger
{
    public const METHODS = ['CASH', 'INSTAPAY', 'WALLET', 'BANK_TRANSFER', 'CARD', 'OTHER'];

    public const SOURCE_MANUAL = 'MANUAL';

    public const SOURCE_GATEWAY = 'GATEWAY';

    public const SOURCE_MIGRATED = 'MIGRATED';

    /** Does this academy hold the feature (and invoicing, which it is a layer of)? */
    public static function enabledFor(string $academyId): bool
    {
        $capabilities = Entitlement::resolve($academyId)['capabilities'];

        return in_array('accounting', $capabilities, true) && in_array('invoicing', $capabilities, true);
    }

    /**
     * Does a guardian's account hold the whole family? In an academy that bills families
     * (PER_GUARDIAN), yes: the bills addressed to the guardian AND any addressed to one of their
     * children (a package or a quick bill raised on the child, the out-of-hours lessons), and the
     * receipts recorded on either. History keeps the addressee it was written with; only the
     * account reads it as one. An academy billing each student keeps each student's own account.
     */
    public static function poolsFamily(string $academyId): bool
    {
        return (DB::table('academies')->where('id', $academyId)->value('invoice_grouping') ?? 'PER_GUARDIAN') !== 'PER_STUDENT';
    }

    /** Is this academy's money kept by receipts right now (adopted)? Cheap — one column. */
    public static function keeps(string $academyId): bool
    {
        return DB::table('academy_ledgers')->where('academy_id', $academyId)->exists();
    }

    /** Adopt lazily: the first receipt of an academy that was switched on some other way. */
    public function ensureReady(string $academyId): void
    {
        if (! self::keeps($academyId)) {
            $this->adopt($academyId);
        }
    }

    // ── Switching on / off ──────────────────────────────────────────────────

    /**
     * Start keeping the academy's invoices by receipts. Every payment recorded the classic way —
     * `amount_paid_minor` with no receipt behind it — becomes ONE receipt (source MIGRATED, dated
     * when it was paid), covering that invoice's lines oldest first. Totals do not move.
     *
     * Idempotent, and safe after an off/on cycle: only the part of an invoice's paid amount that no
     * receipt covers yet is recorded.
     *
     * @return int receipts created
     */
    public function adopt(string $academyId): int
    {
        $tz = $this->timezone($academyId);
        DB::table('academy_ledgers')->insertOrIgnore(['academy_id' => $academyId, 'adopted_at' => now()]);

        $allocated = DB::table('receipt_allocations')
            ->selectRaw('invoice_id, sum(amount_minor) as allocated')
            ->groupBy('invoice_id');

        $invoices = DB::table('invoices as i')
            ->leftJoinSub($allocated, 'a', 'a.invoice_id', '=', 'i.id')
            ->where('i.academy_id', $academyId)
            ->where('i.status', '<>', 'VOID')
            ->whereRaw('i.amount_paid_minor > coalesce(a.allocated, 0)')
            ->orderByRaw('coalesce(i.paid_at, i.updated_at) asc')
            ->orderBy('i.id')
            ->get(['i.*', DB::raw('coalesce(a.allocated, 0) as allocated')]);

        $created = 0;
        foreach ($invoices as $inv) {
            $amount = (int) $inv->amount_paid_minor - (int) $inv->allocated;
            $receipt = $this->insertReceipt($academyId, $this->payerOfInvoice($inv), $amount, (string) $inv->currency, [
                'method' => $this->methodFromInvoice($inv->payment_method),
                'reference' => $inv->payment_reference ?? null,
                'proof_path' => $inv->payment_proof_path ?? null,
                'note' => $inv->payment_reason ?? null,
                'source' => self::SOURCE_MIGRATED,
                'received_on' => Carbon::parse($inv->paid_at ?? $inv->updated_at)->setTimezone($tz)->format('Y-m-d'),
                'received_by' => null,
            ]);
            $this->allocateFifo($receipt, $this->openLines($academyId, null, (string) $inv->currency, (string) $inv->id, lock: true));
            $created++;
        }

        // Bring every receipt-kept invoice's cache in line (an off/on cycle may have left one stale).
        foreach (DB::table('receipt_allocations')->where('academy_id', $academyId)->distinct()->pluck('invoice_id') as $invoiceId) {
            DB::select('select app.ledger_refresh_invoice(?)', [(string) $invoiceId]);
        }

        Audit::log('accounting.adopted', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN', after: ['migrated_receipts' => $created]);

        return $created;
    }

    /** Switched off: the academy goes back to the classic "mark paid". Receipts stay as history. */
    public function release(string $academyId): void
    {
        DB::table('academy_ledgers')->where('academy_id', $academyId)->delete();
        Audit::log('accounting.released', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN');
    }

    // ── Recording ───────────────────────────────────────────────────────────

    /**
     * Record money received from a payer and allocate it: `line_ids` first (in that order, the
     * lines the operator ticked), then — unless `apply_rest` is false — the payer's other unpaid
     * lines oldest first. Whatever is left is the payer's credit. With `invoice_id` the receipt
     * only ever touches that one invoice (the classic "mark this invoice paid", a gateway capture).
     *
     * @param  array{guardian_id?: ?string, student_id?: ?string, payer_name?: ?string}  $payer
     * @param  array{method: string, reference?: ?string, note?: ?string, proof_path?: ?string, received_on?: ?string, received_by?: ?string, source?: string, line_ids?: list<string>, invoice_id?: ?string, apply_rest?: bool, actor_role?: ?string}  $opts
     */
    public function record(string $academyId, array $payer, int $amountMinor, string $currency, array $opts): object
    {
        // Its own savepoint: a 422 thrown half-way (a ticked line already paid) is rendered before
        // the request's tenant transaction sees it, which would otherwise COMMIT the half receipt.
        return DB::transaction(fn () => $this->recordNow($academyId, $payer, $amountMinor, $currency, $opts));
    }

    /**
     * @param  array{guardian_id?: ?string, student_id?: ?string, payer_name?: ?string}  $payer
     * @param  array<string, mixed>  $opts
     */
    private function recordNow(string $academyId, array $payer, int $amountMinor, string $currency, array $opts): object
    {
        $this->ensureReady($academyId);

        if ($amountMinor <= 0) {
            throw ValidationException::withMessages(['amount_minor' => ['The amount must be more than zero. / المبلغ يجب أن يكون أكبر من صفر.']]);
        }
        $payer = $this->normalisePayer($payer);
        $invoiceId = $opts['invoice_id'] ?? null;
        if ($invoiceId !== null && $payer === ['guardian_id' => null, 'student_id' => null, 'payer_name' => null]) {
            $invoice = DB::table('invoices')->where('id', $invoiceId)->first();
            if ($invoice === null) {
                abort(404, 'Invoice not found.');
            }
            $payer = $this->payerOfInvoice($invoice); // paying a named invoice: its payer paid
        }
        if ($payer['guardian_id'] === null && $payer['student_id'] === null && $invoiceId === null) {
            throw ValidationException::withMessages(['payer' => ['Choose who paid. / اختر من دفع.']]);
        }

        $this->lockPayer($academyId, $payer, $invoiceId);

        $receipt = $this->insertReceipt($academyId, $payer, $amountMinor, $currency, $opts);
        $left = $amountMinor;

        // 1. The lines the operator chose, in the order chosen.
        $lineIds = array_values(array_unique($opts['line_ids'] ?? []));
        if ($lineIds !== []) {
            $chosen = $this->openLines($academyId, $invoiceId === null ? $payer : null, $currency, $invoiceId)
                ->whereIn('id', $lineIds)
                ->sortBy(fn ($l) => array_search((string) $l->id, $lineIds, true))
                ->values();
            if ($chosen->count() !== count($lineIds)) {
                throw ValidationException::withMessages(['line_ids' => [
                    'One of the chosen charges is already paid or is not this payer’s. / أحد البنود المختارة مدفوع بالفعل أو لا يخص هذا الدافع.',
                ]]);
            }
            $left -= $this->allocateFifo($receipt, $chosen, $left);
        }

        // 2. Everything else they owe, oldest first.
        if ($left > 0 && ($opts['apply_rest'] ?? true)) {
            $left -= $this->allocateFifo($receipt, $this->openLines($academyId, $invoiceId === null ? $payer : null, $currency, $invoiceId), $left);
        }

        Audit::log('receipt.recorded', 'receipt', (string) $receipt->id, $academyId, $opts['received_by'] ?? null, $opts['actor_role'] ?? null, after: [
            'number' => $receipt->number,
            'amount_minor' => $amountMinor,
            'currency' => $currency,
            'method' => $receipt->method,
            'allocated_minor' => $amountMinor - $left,
            'source' => $receipt->source,
        ]);

        return DB::table('receipts')->where('id', $receipt->id)->first();
    }

    /**
     * Void a receipt: its number stays taken, its money goes back to unpaid on every line it
     * covered — and the payer's other credit, if any, is applied to them again.
     */
    public function void(string $receiptId, string $reason, ?string $actorUserId, ?string $actorRole): object
    {
        return DB::transaction(fn () => $this->voidNow($receiptId, $reason, $actorUserId, $actorRole));
    }

    private function voidNow(string $receiptId, string $reason, ?string $actorUserId, ?string $actorRole): object
    {
        $receipt = DB::table('receipts')->where('id', $receiptId)->lockForUpdate()->first();
        if ($receipt === null) {
            abort(404, 'Receipt not found.');
        }
        if ($receipt->voided_at !== null) {
            throw ValidationException::withMessages(['receipt' => ['This receipt is already void. / هذا الإيصال ملغى بالفعل.']]);
        }

        $covered = DB::table('receipt_allocations')->where('receipt_id', $receiptId)->get(['invoice_line_id', 'amount_minor']);
        DB::table('receipt_allocations')->where('receipt_id', $receiptId)->delete();
        DB::table('receipts')->where('id', $receiptId)->update([
            'voided_at' => now(),
            'voided_by' => $actorUserId,
            'void_reason' => $reason,
            'updated_at' => now(),
        ]);

        $payer = $this->normalisePayer((array) $receipt);
        if ($payer['guardian_id'] !== null || $payer['student_id'] !== null) {
            $this->applyCredit((string) $receipt->academy_id, $payer, (string) $receipt->currency);
        }

        Audit::log('receipt.voided', 'receipt', $receiptId, (string) $receipt->academy_id, $actorUserId, $actorRole, before: [
            'number' => $receipt->number,
            'amount_minor' => (int) $receipt->amount_minor,
            'allocations' => $covered->map(fn ($a) => ['line' => (string) $a->invoice_line_id, 'amount_minor' => (int) $a->amount_minor])->all(),
        ], after: ['reason' => $reason]);

        return DB::table('receipts')->where('id', $receiptId)->first();
    }

    /**
     * Spend the payer's unallocated receipt money on their unpaid lines, oldest receipt on oldest
     * line. Called when a charge is raised for them, and after a void.
     *
     * @param  array{guardian_id?: ?string, student_id?: ?string, payer_name?: ?string}  $payer
     * @return int minor units applied
     */
    public function applyCredit(string $academyId, array $payer, ?string $currency = null): int
    {
        $payer = $this->normalisePayer($payer);
        if ($payer['guardian_id'] === null && $payer['student_id'] === null) {
            return 0; // a typed-in name is not an account — nothing to pool
        }

        $receipts = $this->creditReceipts($academyId, $payer, $currency);
        if ($receipts->isEmpty()) {
            return 0;
        }

        $this->lockPayer($academyId, $payer, null);
        $applied = 0;
        foreach ($receipts as $r) {
            $lines = $this->openLines($academyId, $payer, (string) $r->currency);
            if ($lines->isEmpty()) {
                continue;
            }
            $applied += $this->allocateFifo($r, $lines, (int) $r->unallocated);
        }

        return $applied;
    }

    /**
     * A card payment (XPay / PayPal) just settled this invoice: the gateway's definer function set
     * it PAID with its paid amount at the total. On an academy kept by receipts, the part no receipt
     * covers becomes ONE receipt (source GATEWAY, method CARD) allocated to the invoice's lines —
     * otherwise the next allocation change would recompute the paid amount from receipts and wipe
     * the card payment. A no-op for every other academy.
     *
     * Called from public, tenant-less routes, so it sets the academy's own context for its own
     * transaction and puts the caller's back afterwards.
     */
    public function recordGatewayPayment(string $academyId, string $invoiceId, string $reference): void
    {
        $previous = [
            'app.current_user_id' => DB::selectOne("select current_setting('app.current_user_id', true) as v")->v ?? '',
            'app.current_academy_id' => DB::selectOne("select current_setting('app.current_academy_id', true) as v")->v ?? '',
            'app.current_role' => DB::selectOne("select current_setting('app.current_role', true) as v")->v ?? '',
        ];

        try {
            DB::transaction(function () use ($academyId, $invoiceId, $reference): void {
                TenantContext::apply(null, $academyId, 'SUPER_ADMIN');
                if (! self::keeps($academyId)) {
                    return;
                }

                $invoice = DB::table('invoices')->where('id', $invoiceId)->lockForUpdate()->first();
                if ($invoice === null) {
                    return;
                }
                $uncovered = (int) $invoice->amount_paid_minor
                    - (int) DB::table('receipt_allocations')->where('invoice_id', $invoiceId)->sum('amount_minor');
                if ($uncovered <= 0) {
                    return; // already a receipt behind every unit paid (a retried webhook)
                }

                $receipt = $this->insertReceipt($academyId, $this->payerOfInvoice($invoice), $uncovered, (string) $invoice->currency, [
                    'method' => 'CARD',
                    'reference' => $reference,
                    'source' => self::SOURCE_GATEWAY,
                    'received_by' => null,
                ]);
                $this->allocateFifo($receipt, $this->openLines($academyId, null, (string) $invoice->currency, $invoiceId, lock: true));

                Audit::log('receipt.recorded', 'receipt', (string) $receipt->id, $academyId, null, 'SUPER_ADMIN', after: [
                    'number' => $receipt->number,
                    'amount_minor' => $uncovered,
                    'currency' => (string) $invoice->currency,
                    'method' => 'CARD',
                    'source' => self::SOURCE_GATEWAY,
                    'reference' => $reference,
                ]);
            });
        } finally {
            foreach ($previous as $key => $value) {
                DB::statement('select set_config(?, ?, false)', [$key, (string) $value]);
            }
        }
    }

    /** A line was raised / removed / repriced on this invoice: let the payer's credit follow. */
    public function afterLinesChanged(string $invoiceId): void
    {
        $invoice = DB::table('invoices')->where('id', $invoiceId)->first();
        if ($invoice === null || ! self::keeps((string) $invoice->academy_id)) {
            return;
        }

        $academyId = (string) $invoice->academy_id;
        $payer = $this->payerOfInvoice($invoice);
        $this->applyCredit($academyId, $payer, (string) $invoice->currency);

        // A bill addressed to a child is the family's: the parent's money pays it too.
        if ($payer['student_id'] !== null && self::poolsFamily($academyId)) {
            $guardianId = DB::table('students')->where('id', $payer['student_id'])->value('guardian_id');
            if ($guardianId !== null) {
                $this->applyCredit($academyId, ['guardian_id' => (string) $guardianId], (string) $invoice->currency);
            }
        }
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /**
     * The payer's unpaid lines (remaining > 0), oldest first. `$payer` null + `$invoiceId` = that
     * invoice's lines only.
     *
     * @param  array{guardian_id: ?string, student_id: ?string, payer_name: ?string}|null  $payer
     * @return Collection<int, object>
     */
    public function openLines(string $academyId, ?array $payer, ?string $currency = null, ?string $invoiceId = null, bool $lock = false): Collection
    {
        $query = $this->linesQuery($academyId, $payer, $currency, $invoiceId)
            ->whereRaw('li.amount_minor > coalesce(a.allocated, 0)');

        if ($lock) {
            DB::table('invoices')->whereIn('id', (clone $query)->select('li.invoice_id'))->lockForUpdate()->get(['id']);
        }

        return $query->get();
    }

    /**
     * Where the payer stands, per currency: what they still owe (every unpaid line, the running
     * month included) and the credit they hold.
     *
     * @param  array{guardian_id?: ?string, student_id?: ?string, payer_name?: ?string}  $payer
     * @return list<array{currency: string, due_minor: int, credit_minor: int, balance_minor: int}>
     */
    public function balance(string $academyId, array $payer): array
    {
        $payer = $this->normalisePayer($payer);
        $out = [];
        foreach ($this->openLines($academyId, $payer) as $l) {
            $c = (string) $l->currency;
            $out[$c] ??= ['currency' => $c, 'due_minor' => 0, 'credit_minor' => 0, 'balance_minor' => 0];
            $out[$c]['due_minor'] += (int) $l->amount_minor - (int) $l->allocated;
        }
        foreach ($this->creditReceipts($academyId, $payer, null) as $r) {
            $c = (string) $r->currency;
            $out[$c] ??= ['currency' => $c, 'due_minor' => 0, 'credit_minor' => 0, 'balance_minor' => 0];
            $out[$c]['credit_minor'] += (int) $r->unallocated;
        }
        foreach ($out as $c => $row) {
            $out[$c]['balance_minor'] = $row['due_minor'] - $row['credit_minor'];
        }
        ksort($out);

        return array_values($out);
    }

    /**
     * The account money is recorded against. A student is resolved to whoever their bills go to —
     * their guardian, unless the academy invoices each student — exactly as Invoicing files their
     * charges, so "paid for Adam" always lands on the invoices Adam's lessons are on.
     *
     * @return array{guardian_id: ?string, student_id: ?string}
     */
    public function resolvePayer(string $academyId, ?string $guardianId, ?string $studentId): array
    {
        if ($guardianId !== null) {
            if (! DB::table('guardians')->where('id', $guardianId)->exists()) {
                throw ValidationException::withMessages(['guardian_id' => ['Unknown payer. / دافع غير معروف.']]);
            }

            return ['guardian_id' => $guardianId, 'student_id' => null];
        }
        if ($studentId === null || ! DB::table('students')->where('id', $studentId)->exists()) {
            throw ValidationException::withMessages(['student_id' => ['Unknown payer. / دافع غير معروف.']]);
        }

        [$g, $s] = app(Invoicing::class)->payerOf(DB::table('academies')->where('id', $academyId)->first(), $studentId);

        return ['guardian_id' => $g, 'student_id' => $g === null ? $s : null];
    }

    /**
     * Who an invoice belongs to, as a payer.
     *
     * @return array{guardian_id: ?string, student_id: ?string, payer_name: ?string}
     */
    public function payerOfInvoice(object $invoice): array
    {
        return [
            'guardian_id' => $invoice->guardian_id !== null ? (string) $invoice->guardian_id : null,
            'student_id' => $invoice->guardian_id === null && $invoice->student_id !== null ? (string) $invoice->student_id : null,
            'payer_name' => $invoice->guardian_id === null && $invoice->student_id === null ? ($invoice->payer_name ?? null) : null,
        ];
    }

    // ── internals ───────────────────────────────────────────────────────────

    /**
     * @param  array{guardian_id: ?string, student_id: ?string, payer_name: ?string}|null  $payer
     */
    private function linesQuery(string $academyId, ?array $payer, ?string $currency, ?string $invoiceId)
    {
        $allocated = DB::table('receipt_allocations')
            ->selectRaw('invoice_line_id, sum(amount_minor) as allocated')
            ->groupBy('invoice_line_id');

        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoinSub($allocated, 'a', 'a.invoice_line_id', '=', 'li.id')
            ->leftJoin('students as st', 'st.id', '=', 'li.student_id')
            ->where('i.academy_id', $academyId)
            ->where('i.status', '<>', 'VOID')
            ->where('li.amount_minor', '>', 0)
            ->when($payer !== null, fn ($q) => $this->wherePayer($q, $payer, $academyId))
            ->when($currency !== null, fn ($q) => $q->where('li.currency', $currency))
            ->when($invoiceId !== null, fn ($q) => $q->where('li.invoice_id', $invoiceId))
            ->orderBy('i.period_year')
            ->orderBy('i.period_month')
            ->orderByRaw('li.session_date asc nulls last')
            ->orderBy('li.created_at')
            ->orderBy('li.id')
            ->select([
                'li.id', 'li.invoice_id', 'li.description', 'li.amount_minor', 'li.currency', 'li.student_id',
                'li.list_amount_minor', 'li.discount_minor', 'li.discount_label',
                'st.full_name as student_name', 'li.session_date', 'li.class_group_id', 'li.group_charge', 'li.group_period',
                'i.period_year', 'i.period_month', 'i.status as invoice_status', 'i.kind as invoice_kind',
                DB::raw('coalesce(a.allocated, 0) as allocated'),
            ]);
    }

    /**
     * The documents (invoices `i`, or receipts `r`) on the payer's account — a guardian's being the
     * whole family's where the academy pools it (`poolsFamily`).
     *
     * @param  array{guardian_id: ?string, student_id: ?string, payer_name: ?string}  $payer
     */
    private function wherePayer($query, array $payer, string $academyId, string $alias = 'i')
    {
        if ($payer['guardian_id'] !== null) {
            if (! self::poolsFamily($academyId)) {
                return $query->where("{$alias}.guardian_id", $payer['guardian_id']);
            }

            return $query->where(fn ($q) => $q->where("{$alias}.guardian_id", $payer['guardian_id'])
                ->orWhere(fn ($q) => $q->whereNull("{$alias}.guardian_id")
                    ->whereIn("{$alias}.student_id", DB::table('students')->select('id')->where('guardian_id', $payer['guardian_id']))));
        }
        if ($payer['student_id'] !== null) {
            return $query->whereNull("{$alias}.guardian_id")->where("{$alias}.student_id", $payer['student_id']);
        }

        return $query->whereRaw('false'); // a typed-in name only ever pays a named invoice
    }

    /**
     * Allocate up to `$budget` (default: the receipt's unallocated money) to `$lines` in order.
     *
     * @param  Collection<int, object>  $lines
     * @return int minor units allocated
     */
    private function allocateFifo(object $receipt, Collection $lines, ?int $budget = null): int
    {
        $budget ??= (int) $receipt->amount_minor - (int) DB::table('receipt_allocations')->where('receipt_id', $receipt->id)->sum('amount_minor');
        $spent = 0;

        foreach ($lines as $line) {
            if ($budget - $spent <= 0) {
                break;
            }
            if ((string) $line->currency !== (string) $receipt->currency) {
                continue;
            }
            $remaining = (int) $line->amount_minor - (int) $line->allocated;
            $take = min($remaining, $budget - $spent);
            if ($take <= 0) {
                continue;
            }

            $existing = DB::table('receipt_allocations')->where('receipt_id', $receipt->id)->where('invoice_line_id', $line->id)->first();
            if ($existing !== null) {
                DB::table('receipt_allocations')->where('id', $existing->id)->update(['amount_minor' => (int) $existing->amount_minor + $take]);
            } else {
                DB::table('receipt_allocations')->insert([
                    'id' => (string) Str::uuid(),
                    'academy_id' => $receipt->academy_id,
                    'receipt_id' => $receipt->id,
                    'invoice_line_id' => $line->id,
                    'invoice_id' => $line->invoice_id,
                    'amount_minor' => $take,
                    'created_at' => now(),
                ]);
            }
            $line->allocated = (int) $line->allocated + $take;
            $spent += $take;
        }

        return $spent;
    }

    /**
     * The payer's receipts with money not yet allocated, oldest first.
     *
     * @param  array{guardian_id: ?string, student_id: ?string, payer_name: ?string}  $payer
     * @return Collection<int, object>
     */
    private function creditReceipts(string $academyId, array $payer, ?string $currency): Collection
    {
        if ($payer['guardian_id'] === null && $payer['student_id'] === null) {
            return collect();
        }

        $allocated = DB::table('receipt_allocations')
            ->selectRaw('receipt_id, sum(amount_minor) as allocated')
            ->groupBy('receipt_id');

        return DB::table('receipts as r')
            ->leftJoinSub($allocated, 'a', 'a.receipt_id', '=', 'r.id')
            ->where('r.academy_id', $academyId)
            ->whereNull('r.voided_at')
            ->tap(fn ($q) => $this->wherePayer($q, $payer, $academyId, 'r'))
            ->when($currency !== null, fn ($q) => $q->where('r.currency', $currency))
            ->whereRaw('r.amount_minor > coalesce(a.allocated, 0)')
            ->orderBy('r.received_on')
            ->orderBy('r.created_at')
            ->get(['r.*', DB::raw('r.amount_minor - coalesce(a.allocated, 0) as unallocated')]);
    }

    /**
     * Serialise concurrent receipts for one payer: lock their invoices (or the one invoice).
     *
     * @param  array{guardian_id: ?string, student_id: ?string, payer_name: ?string}  $payer
     */
    private function lockPayer(string $academyId, array $payer, ?string $invoiceId): void
    {
        $q = DB::table('invoices as i')->where('i.academy_id', $academyId);
        if ($invoiceId !== null) {
            $q->where('i.id', $invoiceId);
        } else {
            $this->wherePayer($q, $payer, $academyId);
        }
        $q->orderBy('i.id')->lockForUpdate()->get(['i.id']);
    }

    /**
     * @param  array{guardian_id: ?string, student_id: ?string, payer_name: ?string}  $payer
     * @param  array<string, mixed>  $opts
     */
    private function insertReceipt(string $academyId, array $payer, int $amountMinor, string $currency, array $opts): object
    {
        $method = (string) ($opts['method'] ?? 'CASH');
        if (! in_array($method, self::METHODS, true)) {
            throw ValidationException::withMessages(['method' => ['Unknown payment method.']]);
        }

        // The treasury account the money lands in (cash → the drawer …), when one is set up. A day
        // already counted and closed for that account takes nothing new — except money a card
        // gateway reports, or a payment carried over from before receipts: that is history.
        $source = $opts['source'] ?? self::SOURCE_MANUAL;
        $receivedOn = $opts['received_on'] ?? Carbon::now($this->timezone($academyId))->format('Y-m-d');
        $treasury = app(Treasury::class);
        $accountId = $opts['cash_account_id'] ?? ($source === self::SOURCE_MIGRATED ? null : $treasury->accountForReceipt($academyId, $method, $currency));
        if ($accountId !== null && $source === self::SOURCE_MANUAL) {
            $treasury->assertOpenDay($accountId, $receivedOn);
        }

        $id = (string) Str::uuid();
        DB::table('receipts')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'cash_account_id' => $accountId,
            'number' => $this->nextNumber($academyId),
            'guardian_id' => $payer['guardian_id'],
            'student_id' => $payer['student_id'],
            'payer_name' => $payer['payer_name'],
            'amount_minor' => $amountMinor,
            'currency' => strtoupper($currency),
            'method' => $method,
            'reference' => $this->clean($opts['reference'] ?? null),
            'proof_path' => $opts['proof_path'] ?? null,
            'note' => $this->clean($opts['note'] ?? null),
            'source' => $source,
            'received_on' => $receivedOn,
            'received_by' => $opts['received_by'] ?? null,
            'public_token' => bin2hex(random_bytes(20)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('receipts')->where('id', $id)->first();
    }

    /** R-000001, R-000002 … per academy, never reused (a void keeps its number). */
    private function nextNumber(string $academyId): string
    {
        $value = (int) DB::selectOne(
            'insert into academy_counters (academy_id, key, value) values (?, ?, 1)
             on conflict (academy_id, key) do update set value = academy_counters.value + 1
             returning value',
            [$academyId, 'receipt'],
        )->value;

        return 'R-'.str_pad((string) $value, 6, '0', STR_PAD_LEFT);
    }

    /**
     * @param  array<string, mixed>  $payer
     * @return array{guardian_id: ?string, student_id: ?string, payer_name: ?string}
     */
    private function normalisePayer(array $payer): array
    {
        $guardian = $payer['guardian_id'] ?? null;
        $student = $guardian === null ? ($payer['student_id'] ?? null) : null;
        $name = $guardian === null && $student === null ? $this->clean($payer['payer_name'] ?? null) : null;

        return [
            'guardian_id' => $guardian !== null ? (string) $guardian : null,
            'student_id' => $student !== null ? (string) $student : null,
            'payer_name' => $name,
        ];
    }

    private function methodFromInvoice(?string $method): string
    {
        return match ($method) {
            'CASH' => 'CASH',
            'BANK_TRANSFER' => 'BANK_TRANSFER',
            'GATEWAY' => 'CARD',
            default => 'OTHER',
        };
    }

    private function clean(mixed $value): ?string
    {
        $value = is_string($value) ? trim($value) : null;

        return $value === null || $value === '' ? null : $value;
    }

    private function timezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
    }
}
