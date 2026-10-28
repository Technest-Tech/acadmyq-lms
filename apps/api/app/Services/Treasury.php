<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The treasury (الخزينة, docs/groups/01-ACCOUNTING.md): where the academy's money is.
 *
 * An account (the cash drawer, the InstaPay account, the bank…) starts on its opening day with an
 * opening balance; from then on
 *
 *   balance(day) = opening + receipts in − expenses out + transfers in − transfers out
 *                  + every closing difference (counted − expected) up to that day
 *                  + every balance adjustment (actual − books, the day left open) up to that day
 *
 * A receipt lands in the account its method maps to (cash → the drawer). One recorded before the
 * treasury existed, or before its method was mapped, follows today's mapping — but only movements
 * dated on or after an account's opening day ever count, so setting the treasury up never pulls
 * old history into today's drawer.
 *
 * A closed day is locked: nothing new may be dated on or before an account's last closing, so the
 * count stays true. (A card payment settling late is the exception — the money arrived; it is
 * never refused.) Runs inside the caller's tenant transaction.
 */
final class Treasury
{
    public const KINDS = ['CASH', 'BANK', 'WALLET', 'INSTAPAY', 'CARD', 'OTHER'];

    /** The categories every academy starts with; `key` is stable, `name` is editable. */
    public const DEFAULT_CATEGORIES = [
        'teacher_salaries' => 'رواتب المعلمين',
        'staff_salaries' => 'رواتب الموظفين',
        'rent' => 'الإيجار',
        'utilities' => 'كهرباء ومياه وإنترنت',
        'books' => 'كتب ومواد تعليمية',
        'printing' => 'طباعة وأدوات مكتبية',
        'marketing' => 'تسويق وإعلانات',
        'maintenance' => 'صيانة',
        'other' => 'مصروفات أخرى',
        // Credit paid back to a family (PackageSettlement / a refund from the family card).
        'refunds' => 'رد مبالغ للأسر',
    ];

    public function ensureCategories(string $academyId): void
    {
        if (DB::table('expense_categories')->where('academy_id', $academyId)->exists()) {
            return;
        }
        $i = 0;
        foreach (self::DEFAULT_CATEGORIES as $key => $name) {
            // Refunds are a centre's (PackageSettlement): made on the first one, never listed up front.
            if ($key === 'refunds') {
                continue;
            }
            DB::table('expense_categories')->insert(['academy_id' => $academyId, 'key' => $key, 'name' => $name, 'sort_order' => $i++]);
        }
    }

    public function categoryId(string $academyId, string $key): string
    {
        $this->ensureCategories($academyId);
        // A default added after the academy's categories were set up (refunds) is created on first use.
        if (isset(self::DEFAULT_CATEGORIES[$key])) {
            DB::table('expense_categories')->insertOrIgnore([
                'academy_id' => $academyId, 'key' => $key, 'name' => self::DEFAULT_CATEGORIES[$key], 'sort_order' => count(self::DEFAULT_CATEGORIES),
            ]);
        }

        return (string) DB::table('expense_categories')->where('academy_id', $academyId)->where('key', $key)->value('id');
    }

    /** The account a receipt of this method and currency lands in, or null when none is mapped. */
    public function accountForReceipt(string $academyId, string $method, string $currency): ?string
    {
        $id = DB::table('cash_account_methods')
            ->where('academy_id', $academyId)->where('method', $method)->where('currency', strtoupper($currency))
            ->value('cash_account_id');

        return $id !== null ? (string) $id : null;
    }

    /** Refuse a movement dated on or before the account's last closed day. */
    public function assertOpenDay(string $accountId, string $date): void
    {
        $closed = DB::table('cash_closings')->where('cash_account_id', $accountId)->max('day');
        if ($closed !== null && Carbon::parse($date)->format('Y-m-d') <= Carbon::parse($closed)->format('Y-m-d')) {
            throw ValidationException::withMessages(['date' => [
                'That day is already closed for this account ('.Carbon::parse($closed)->format('Y-m-d').'). / هذا اليوم مُقفل بالفعل لهذه الخزنة.',
            ]]);
        }
    }

    /**
     * Each account's balance at the end of `$day` (default: today), with what moved that day.
     *
     * @return array<string, array{balance_minor: int, in_minor: int, out_minor: int}>
     */
    public function balances(string $academyId, ?string $day = null): array
    {
        $day ??= Carbon::now($this->timezone($academyId))->format('Y-m-d');
        $out = [];
        foreach (DB::table('cash_accounts')->where('academy_id', $academyId)->get() as $a) {
            $out[(string) $a->id] = $this->balanceOf($a, $day);
        }

        return $out;
    }

    /** @return array{balance_minor: int, in_minor: int, out_minor: int} */
    public function balanceOf(object $account, string $day): array
    {
        $from = Carbon::parse($account->opening_on)->format('Y-m-d');
        $m = $this->movementSums((string) $account->id, $from, $day);
        $today = $this->movementSums((string) $account->id, $day, $day);

        return [
            'balance_minor' => (int) $account->opening_balance_minor + $m['in'] - $m['out'] + $m['adjust'],
            'in_minor' => $today['in'],
            'out_minor' => $today['out'],
        ];
    }

    /**
     * Every movement of an account between two days, oldest first, with the running balance —
     * and the balance brought forward from before `$from`.
     *
     * @return array{opening_minor: int, entries: list<array<string, mixed>>, closing_minor: int}
     */
    public function ledger(object $account, string $from, string $to): array
    {
        $opening = Carbon::parse($account->opening_on)->format('Y-m-d');
        $from = max($from, $opening);
        $before = Carbon::parse($from)->subDay()->format('Y-m-d');
        $broughtForward = $before < $opening
            ? (int) $account->opening_balance_minor
            : $this->balanceOf($account, $before)['balance_minor'];

        $id = (string) $account->id;
        $entries = [];
        foreach ($this->receiptsQuery($id)->whereBetween('r.received_on', [$from, $to])
            ->leftJoin('guardians as g', 'g.id', '=', 'r.guardian_id')->leftJoin('students as s', 's.id', '=', 'r.student_id')
            ->get(['r.id', 'r.number', 'r.received_on', 'r.created_at', 'r.amount_minor', 'r.method', 'r.guardian_id', 'r.student_id', DB::raw('coalesce(g.full_name, s.full_name, r.payer_name) as party')]) as $r) {
            $entries[] = ['kind' => 'RECEIPT', 'id' => (string) $r->id, 'date' => Carbon::parse($r->received_on)->format('Y-m-d'), 'at' => (string) $r->created_at,
                'label' => (string) $r->number, 'party' => $r->party, 'method' => (string) $r->method, 'in_minor' => (int) $r->amount_minor, 'out_minor' => 0,
                // So the ledger can open the family the money came from.
                'guardian_id' => $r->guardian_id !== null ? (string) $r->guardian_id : null, 'student_id' => $r->student_id !== null ? (string) $r->student_id : null];
        }
        foreach (DB::table('expenses as e')->join('expense_categories as c', 'c.id', '=', 'e.category_id')->leftJoin('users as u', 'u.id', '=', 'e.created_by')
            ->where('e.cash_account_id', $id)->whereNull('e.voided_at')->whereBetween('e.spent_on', [$from, $to])
            ->get(['e.id', 'e.number', 'e.spent_on', 'e.created_at', 'e.amount_minor', 'e.payee', 'e.description', 'e.attachment_path', 'e.payout_id', 'c.name as category', 'c.key as category_key', 'u.full_name as by']) as $e) {
            $entries[] = ['kind' => 'EXPENSE', 'id' => (string) $e->id, 'date' => Carbon::parse($e->spent_on)->format('Y-m-d'), 'at' => (string) $e->created_at,
                'label' => (string) $e->number, 'party' => $e->payee, 'category' => (string) $e->category, 'category_key' => $e->category_key, 'description' => $e->description,
                'has_attachment' => $e->attachment_path !== null, 'payout_id' => $e->payout_id !== null ? (string) $e->payout_id : null, 'by' => $e->by,
                'in_minor' => 0, 'out_minor' => (int) $e->amount_minor];
        }
        foreach (DB::table('cash_transfers as t')->join('cash_accounts as fa', 'fa.id', '=', 't.from_account_id')->join('cash_accounts as ta', 'ta.id', '=', 't.to_account_id')
            ->leftJoin('users as u', 'u.id', '=', 't.created_by')
            ->whereNull('t.voided_at')->where(fn ($q) => $q->where('t.from_account_id', $id)->orWhere('t.to_account_id', $id))
            ->whereBetween('t.transferred_on', [$from, $to])
            ->get(['t.id', 't.transferred_on', 't.created_at', 't.amount_minor', 't.note', 't.from_account_id', 'fa.name as from_name', 'ta.name as to_name', 'u.full_name as by']) as $t) {
            $outgoing = (string) $t->from_account_id === $id;
            $entries[] = ['kind' => $outgoing ? 'TRANSFER_OUT' : 'TRANSFER_IN', 'id' => (string) $t->id, 'date' => Carbon::parse($t->transferred_on)->format('Y-m-d'), 'at' => (string) $t->created_at,
                'label' => $outgoing ? (string) $t->to_name : (string) $t->from_name, 'description' => $t->note,
                'from_name' => (string) $t->from_name, 'to_name' => (string) $t->to_name, 'by' => $t->by,
                'in_minor' => $outgoing ? 0 : (int) $t->amount_minor, 'out_minor' => $outgoing ? (int) $t->amount_minor : 0];
        }
        foreach (DB::table('cash_closings as c')->leftJoin('users as u', 'u.id', '=', 'c.closed_by')->where('c.cash_account_id', $id)->whereBetween('c.day', [$from, $to])
            ->get(['c.id', 'c.day', 'c.created_at', 'c.expected_minor', 'c.counted_minor', 'c.difference_minor', 'c.note', 'u.full_name as by']) as $c) {
            $diff = (int) $c->difference_minor;
            $entries[] = ['kind' => 'CLOSING', 'id' => (string) $c->id, 'date' => Carbon::parse($c->day)->format('Y-m-d'), 'at' => '9999', // a day's count closes it: last
                'label' => $c->by, 'by' => $c->by, 'description' => $c->note, 'expected_minor' => (int) $c->expected_minor, 'counted_minor' => (int) $c->counted_minor,
                'in_minor' => max(0, $diff), 'out_minor' => max(0, -$diff)];
        }
        foreach (DB::table('cash_adjustments as a')->leftJoin('users as u', 'u.id', '=', 'a.created_by')->where('a.cash_account_id', $id)->whereNull('a.voided_at')
            ->whereBetween('a.adjusted_on', [$from, $to])
            ->get(['a.id', 'a.adjusted_on', 'a.created_at', 'a.expected_minor', 'a.actual_minor', 'a.amount_minor', 'a.reason', 'u.full_name as by']) as $a) {
            $diff = (int) $a->amount_minor;
            $entries[] = ['kind' => 'ADJUSTMENT', 'id' => (string) $a->id, 'date' => Carbon::parse($a->adjusted_on)->format('Y-m-d'), 'at' => (string) $a->created_at,
                'label' => $a->by, 'by' => $a->by, 'description' => $a->reason, 'expected_minor' => (int) $a->expected_minor, 'actual_minor' => (int) $a->actual_minor,
                'in_minor' => max(0, $diff), 'out_minor' => max(0, -$diff)];
        }
        usort($entries, fn ($a, $b) => [$a['date'], $a['at']] <=> [$b['date'], $b['at']]);

        $running = $broughtForward;
        foreach ($entries as $i => $e) {
            $running += $e['in_minor'] - $e['out_minor'];
            $entries[$i]['balance_minor'] = $running;
            unset($entries[$i]['at']);
        }

        return ['opening_minor' => $broughtForward, 'entries' => $entries, 'closing_minor' => $running];
    }

    /**
     * Whether anything was ever recorded against the account — even voided, even a receipt that
     * only lands in it by its method. Such an account is stopped, never deleted: its history stays.
     */
    public function hasHistory(string $accountId): bool
    {
        $opening = DB::table('cash_accounts')->where('id', $accountId)->value('opening_on');

        return DB::table('receipts')->where('cash_account_id', $accountId)->exists()
            || ($opening !== null && $this->receiptsQuery($accountId)->where('r.received_on', '>=', $opening)->exists())
            || DB::table('expenses')->where('cash_account_id', $accountId)->exists()
            || DB::table('cash_transfers')->where(fn ($q) => $q->where('from_account_id', $accountId)->orWhere('to_account_id', $accountId))->exists()
            || DB::table('cash_closings')->where('cash_account_id', $accountId)->exists()
            || DB::table('cash_adjustments')->where('cash_account_id', $accountId)->exists();
    }

    /** The first day something live is filed under the account itself (its opening day may not pass it), or null. */
    public function firstMovementOn(string $accountId): ?string
    {
        $days = array_filter([
            DB::table('receipts')->where('cash_account_id', $accountId)->whereNull('voided_at')->min('received_on'),
            DB::table('expenses')->where('cash_account_id', $accountId)->whereNull('voided_at')->min('spent_on'),
            DB::table('cash_transfers')->whereNull('voided_at')->where(fn ($q) => $q->where('from_account_id', $accountId)->orWhere('to_account_id', $accountId))->min('transferred_on'),
            DB::table('cash_adjustments')->where('cash_account_id', $accountId)->whereNull('voided_at')->min('adjusted_on'),
        ]);

        return $days === [] ? null : Carbon::parse(min(array_map(fn ($d) => Carbon::parse($d)->format('Y-m-d'), $days)))->format('Y-m-d');
    }

    /** E-000001 … per academy, never reused. */
    public function nextNumber(string $academyId, string $key, string $prefix): string
    {
        $value = (int) DB::selectOne(
            'insert into academy_counters (academy_id, key, value) values (?, ?, 1)
             on conflict (academy_id, key) do update set value = academy_counters.value + 1
             returning value',
            [$academyId, $key],
        )->value;

        return $prefix.'-'.str_pad((string) $value, 6, '0', STR_PAD_LEFT);
    }

    /** Receipts that land in an account: assigned to it, or (none assigned) mapped to it by method. */
    public function receiptsQuery(string $accountId)
    {
        $account = DB::table('cash_accounts')->where('id', $accountId)->first(['academy_id', 'currency']);

        return DB::table('receipts as r')
            ->leftJoin('cash_account_methods as m', function ($j): void {
                $j->on('m.academy_id', '=', 'r.academy_id')->on('m.method', '=', 'r.method')->on('m.currency', '=', 'r.currency');
            })
            ->whereNull('r.voided_at')
            ->where('r.currency', $account->currency ?? '')
            ->whereRaw('coalesce(r.cash_account_id, m.cash_account_id) = ?', [$accountId]);
    }

    /** @return array{in: int, out: int, adjust: int} */
    private function movementSums(string $accountId, string $from, string $to): array
    {
        $in = (int) $this->receiptsQuery($accountId)->whereBetween('r.received_on', [$from, $to])->sum('r.amount_minor');
        $out = (int) DB::table('expenses')->where('cash_account_id', $accountId)->whereNull('voided_at')->whereBetween('spent_on', [$from, $to])->sum('amount_minor');
        $tin = (int) DB::table('cash_transfers')->where('to_account_id', $accountId)->whereNull('voided_at')->whereBetween('transferred_on', [$from, $to])->sum('amount_minor');
        $tout = (int) DB::table('cash_transfers')->where('from_account_id', $accountId)->whereNull('voided_at')->whereBetween('transferred_on', [$from, $to])->sum('amount_minor');
        $adjust = (int) DB::table('cash_closings')->where('cash_account_id', $accountId)->whereBetween('day', [$from, $to])->sum('difference_minor')
            + (int) DB::table('cash_adjustments')->where('cash_account_id', $accountId)->whereNull('voided_at')->whereBetween('adjusted_on', [$from, $to])->sum('amount_minor');

        return ['in' => $in + $tin, 'out' => $out + $tout, 'adjust' => $adjust];
    }

    private function timezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
    }
}
