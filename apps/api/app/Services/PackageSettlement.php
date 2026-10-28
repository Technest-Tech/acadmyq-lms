<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use App\Support\Entitlement;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * What becomes of the money a prepaid subscription did not use (docs/groups/01-ACCOUNTING.md, "A
 * subscription that ends early").
 *
 * A private subscription billed up front (ON_START) charges its whole block the day it opens. A
 * family that stops part-way — 8 lessons bought, 3 taken — paid for lessons it never had. Such a
 * block closes PENDING, and stays so (on the family's account, whatever happens to the child —
 * suspended, deactivated, moved) until someone decides:
 *
 *   CREDIT  the block's line comes down to what was used (its agreed price, after any discount,
 *           × used / bought); the ledger frees what was paid beyond it as the family's credit,
 *           which pays their next charges by itself and shows on their account until then.
 *   REFUND  the same, and that credit is paid back now out of a treasury account: an expense under
 *           "رد مبالغ للأسر" drawn on the receipts that held the money.
 *   KEEP    the academy keeps it — the decision and why are recorded, nothing moves.
 *
 * Only what was actually PAID beyond what was used ever comes back: a bill let go
 * (ChargeCancellation) or never paid returns nothing. Only where the books are kept by receipts.
 */
final class PackageSettlement
{
    public const MODES = ['CREDIT', 'REFUND', 'KEEP'];

    public function __construct(private readonly Ledger $ledger, private readonly Treasury $treasury) {}

    /** A curriculum centre (`centre`) on receipts — no other academy's subscription is ever settled. */
    public static function availableFor(string $academyId): bool
    {
        return Ledger::keeps($academyId) && Entitlement::hasCapability($academyId, 'centre');
    }

    /**
     * Where a block stands: what is left of it, what it was worth, what was paid, what would come
     * back. Null when a settlement has nothing to work on (billed at the end, no bill, books not
     * kept by receipts, or its line edited by hand — or already brought down by a settlement).
     *
     * @return array{settlement: ?string, unused_minutes: int, lesson_minutes: ?int, price_minor: int, used_minor: int, paid_minor: int, owed_back_minor: int, currency: string}|null
     */
    public function preview(object $package): ?array
    {
        if ($package->bill_timing !== 'ON_START' || $package->invoice_id === null || ! self::availableFor((string) $package->academy_id)) {
            return null;
        }
        $line = $this->packageLine($package);
        if ($line === null) {
            return null;
        }

        $bought = (int) $package->minutes_total;
        $unused = min($bought, max(0, $bought + (int) $package->carried_over_minutes - (int) $package->minutes_consumed));
        // The price agreed for the block — a line let go down to what was paid still remembers it.
        $agreed = $line->list_amount_minor !== null
            ? (int) $line->list_amount_minor - (int) $line->discount_minor
            : (int) $line->amount_minor + (int) ($line->cancelled_minor ?? 0);
        $used = min($agreed, (int) round($agreed * ($bought - $unused) / max(1, $bought)));
        $open = $package->settlement === null || $package->settlement === 'PENDING';

        return [
            'settlement' => $package->settlement,
            'unused_minutes' => $unused,
            'lesson_minutes' => isset($package->lesson_minutes) ? (int) $package->lesson_minutes : null,
            'price_minor' => $agreed,
            'used_minor' => $used,
            'paid_minor' => (int) $line->allocated,
            // For a block still running: what would come back if it were closed now.
            'owed_back_minor' => $open ? max(0, (int) $line->allocated - $used) : 0,
            'currency' => (string) $package->currency,
        ];
    }

    /** A block just closed with lessons left on its bill: someone has to decide what becomes of them. */
    public function markIfOwed(string $packageId): void
    {
        $package = DB::table('lesson_packages')->where('id', $packageId)->first();
        if ($package === null || $package->status === 'ACTIVE' || $package->settlement !== null) {
            return;
        }
        $preview = $this->preview($package);
        if ($preview !== null && $preview['unused_minutes'] > 0 && $preview['used_minor'] < $preview['price_minor']) {
            DB::table('lesson_packages')->where('id', $packageId)->update(['settlement' => 'PENDING', 'updated_at' => now()]);
        }
    }

    /**
     * Settle a closed block. REFUND needs the treasury account the money leaves.
     *
     * @return array{mode: string, amount_minor: int, currency: string, expense_id: ?string, expense_number: ?string}
     */
    public function settle(string $packageId, string $mode, ?string $cashAccountId, ?string $note, ?string $userId, ?string $role): array
    {
        // Its own savepoint: a refused refund (a closed day) must not leave the bill brought down.
        return DB::transaction(function () use ($packageId, $mode, $cashAccountId, $note, $userId, $role): array {
            $package = DB::table('lesson_packages')->where('id', $packageId)->lockForUpdate()->first();
            if ($package === null) {
                abort(404, 'Package not found.');
            }
            if ($package->status === 'ACTIVE') {
                throw ValidationException::withMessages(['package' => ['End the subscription first. / أنهِ الاشتراك أولًا.']]);
            }
            if (! in_array($package->settlement, [null, 'PENDING'], true)) {
                throw ValidationException::withMessages(['package' => ['This subscription is already settled. / تمت تسوية هذا الاشتراك بالفعل.']]);
            }
            $preview = $this->preview($package);
            if ($preview === null || $preview['owed_back_minor'] <= 0) {
                throw ValidationException::withMessages(['package' => ['Nothing was paid beyond what was used. / لم يُدفع شيء زيادة عن المستخدم.']]);
            }
            $amount = $preview['owed_back_minor'];
            $currency = $preview['currency'];
            $note = $note !== null && trim($note) !== '' ? trim($note) : null;
            $expense = null;

            if ($mode !== 'KEEP') {
                $line = $this->packageLine($package);
                $this->bringDown($package, $line, $preview);
                $invoice = DB::table('invoices')->where('id', $line->invoice_id)->first();
                if ($mode === 'REFUND') {
                    $expense = $this->refundCredit((string) $package->academy_id, $this->ledger->payerOfInvoice($invoice), $amount, $currency, (string) $cashAccountId,
                        $note ?? 'Unused subscription: '.$package->label.' / باقي اشتراك لم يُستخدم', $userId, $role);
                }
                // What is left of the credit pays whatever else the family owes.
                $this->ledger->afterLinesChanged((string) $invoice->id);
            }

            DB::table('lesson_packages')->where('id', $packageId)->update([
                'settlement' => $mode,
                'settled_minor' => $amount,
                'settled_at' => now(),
                'settled_by' => $userId,
                'settle_note' => $note,
                'settle_expense_id' => $expense['expense_id'] ?? null,
                'updated_at' => now(),
            ]);
            Audit::log('lesson_package.settled', 'lesson_package', $packageId, (string) $package->academy_id, $userId, $role,
                before: ['settlement' => $package->settlement, 'paid_minor' => $preview['paid_minor'], 'used_minor' => $preview['used_minor']],
                after: ['settlement' => $mode, 'amount_minor' => $amount, 'currency' => $currency, 'note' => $note, 'expense_id' => $expense['expense_id'] ?? null]);

            return ['mode' => $mode, 'amount_minor' => $amount, 'currency' => $currency,
                'expense_id' => $expense['expense_id'] ?? null, 'expense_number' => $expense['number'] ?? null];
        });
    }

    /**
     * Pay a payer's credit back out of a treasury account: an expense under "رد مبالغ للأسر" (the
     * money leaves the account) drawn on the receipts that held it (it leaves their credit).
     *
     * @param  array{guardian_id?: ?string, student_id?: ?string, payer_name?: ?string}  $payer
     * @return array{expense_id: string, number: string}
     */
    public function refundCredit(string $academyId, array $payer, int $amountMinor, string $currency, string $cashAccountId, ?string $description, ?string $userId, ?string $role): array
    {
        if (! self::availableFor($academyId)) {
            throw ValidationException::withMessages(['amount_minor' => ['Paying credit back is for centres on the accounts. / رد الرصيد متاح للمراكز مع الحسابات.']]);
        }

        return DB::transaction(function () use ($academyId, $payer, $amountMinor, $currency, $cashAccountId, $description, $userId, $role): array {
            $account = DB::table('cash_accounts')->where('id', $cashAccountId)->where('is_active', true)->first();
            if ($account === null) {
                throw ValidationException::withMessages(['cash_account_id' => ['Choose the account the money is paid from. / اختر الخزنة التي يُصرف منها المبلغ.']]);
            }
            if ((string) $account->currency !== $currency) {
                throw ValidationException::withMessages(['cash_account_id' => ['Pay back from an account in '.$currency.'. / اصرف من خزنة بنفس العملة.']]);
            }
            $today = Carbon::now((string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC'))->format('Y-m-d');
            $this->treasury->assertOpenDay((string) $account->id, $today);

            $payee = isset($payer['guardian_id']) && $payer['guardian_id'] !== null
                ? DB::table('guardians')->where('id', $payer['guardian_id'])->value('full_name')
                : (isset($payer['student_id']) && $payer['student_id'] !== null ? DB::table('students')->where('id', $payer['student_id'])->value('full_name') : null);
            $id = (string) Str::uuid();
            $number = $this->treasury->nextNumber($academyId, 'expense', 'E');
            DB::table('expenses')->insert([
                'id' => $id, 'academy_id' => $academyId, 'number' => $number, 'spent_on' => $today,
                'category_id' => $this->treasury->categoryId($academyId, 'refunds'),
                'amount_minor' => $amountMinor, 'currency' => $currency, 'cash_account_id' => $account->id,
                'payee' => $payee, 'description' => $description, 'created_by' => $userId,
            ]);
            $this->ledger->refund($academyId, $payer, $amountMinor, $currency, $id);

            Audit::log('expense.recorded', 'expense', $id, $academyId, $userId, $role,
                after: ['number' => $number, 'amount_minor' => $amountMinor, 'account' => $account->name, 'refund' => true]);

            return ['expense_id' => $id, 'number' => $number];
        });
    }

    /**
     * The family's closed blocks still waiting on a decision — the children who left included.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function pendingFor(string $guardianId): Collection
    {
        return DB::table('lesson_packages as p')
            ->join('students as s', 's.id', '=', 'p.student_id')
            ->where('s.guardian_id', $guardianId)
            ->where('p.settlement', 'PENDING')
            ->orderBy('p.closed_at')
            ->get(['p.*', 's.full_name as student_name'])
            ->map(fn ($p) => ($preview = $this->preview($p)) !== null && $preview['owed_back_minor'] > 0
                ? ['package_id' => (string) $p->id, 'student_id' => (string) $p->student_id, 'student_name' => (string) $p->student_name,
                    'label' => (string) $p->label, 'closed_on' => $p->closed_at !== null ? Carbon::parse($p->closed_at)->format('Y-m-d') : null] + $preview
                : null)
            ->filter()
            ->values();
    }

    /** The treasury accounts money can be paid back from, in a currency. */
    public function accounts(string $currency): array
    {
        return DB::table('cash_accounts')->where('is_active', true)->where('currency', $currency)->orderBy('sort_order')->get(['id', 'name', 'kind'])
            ->map(fn ($a) => ['id' => (string) $a->id, 'name' => (string) $a->name, 'kind' => (string) $a->kind])->all();
    }

    /**
     * The block's line comes down to what was used, and its bill with it — closed or not (the one
     * change a closed bill allows, named for this transaction). The ledger gives what was paid
     * beyond it back to the receipts as credit.
     */
    private function bringDown(object $package, object $line, array $preview): void
    {
        $used = $preview['used_minor'];
        $cut = (int) $line->amount_minor - $used;
        if ($cut <= 0) {
            return;
        }
        $bought = max(1, (int) $package->minutes_total);
        $list = $line->list_amount_minor !== null ? (int) round((int) $line->list_amount_minor * ($bought - $preview['unused_minutes']) / $bought) : null;
        $packages = app(LessonPackages::class);

        DB::statement("select set_config('app.settling_invoice_id', ?, true)", [(string) $line->invoice_id]);
        try {
            DB::table('invoice_line_items')->where('id', $line->id)->update([
                'amount_minor' => $used,
                'list_amount_minor' => $list !== null ? max($list, $used) : null,
                'discount_minor' => $list !== null ? max($list, $used) - $used : $line->discount_minor,
                'description' => $line->description.' — '.$packages->humanHours($bought - $preview['unused_minutes']).' used',
            ]);
            DB::table('invoices')->where('id', $line->invoice_id)->update([
                'subtotal_minor' => DB::raw("subtotal_minor - {$cut}"),
                'total_minor' => DB::raw("total_minor - {$cut}"),
                'updated_at' => now(),
            ]);
        } finally {
            DB::statement("select set_config('app.settling_invoice_id', '', true)");
        }
        // Paid in full now that it asks less: the bill's status follows.
        DB::select('select app.ledger_refresh_invoice(?)', [(string) $line->invoice_id]);
    }

    /** The block's own line on its bill (not a previous block's overdraft riding along), with what receipts cover of it. */
    private function packageLine(object $package): ?object
    {
        $allocated = DB::table('receipt_allocations')->selectRaw('invoice_line_id, sum(amount_minor) as allocated')->groupBy('invoice_line_id');

        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoinSub($allocated, 'a', 'a.invoice_line_id', '=', 'li.id')
            ->where('li.invoice_id', $package->invoice_id)
            ->where('i.status', '<>', 'VOID')
            ->whereNull('li.session_id')
            ->where('li.description', app(LessonPackages::class)->packageLineDescription((string) $package->label, (int) $package->minutes_total, (int) $package->carried_over_minutes))
            ->first(['li.*', DB::raw('coalesce(a.allocated, 0) as allocated')]);
    }
}
