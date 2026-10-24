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
    ];

    public function ensureCategories(string $academyId): void
    {
        if (DB::table('expense_categories')->where('academy_id', $academyId)->exists()) {
            return;
        }
        $i = 0;
        foreach (self::DEFAULT_CATEGORIES as $key => $name) {
            DB::table('expense_categories')->insert(['academy_id' => $academyId, 'key' => $key, 'name' => $name, 'sort_order' => $i++]);
        }
    }

    public function categoryId(string $academyId, string $key): string
    {
        $this->ensureCategories($academyId);

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
        foreach (DB::table('expenses as e')->join('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->where('e.cash_account_id', $id)->whereNull('e.voided_at')->whereBetween('e.spent_on', [$from, $to])
            ->get(['e.id', 'e.number', 'e.spent_on', 'e.created_at', 'e.amount_minor', 'e.payee', 'e.description', 'c.name as category']) as $e) {
            $entries[] = ['kind' => 'EXPENSE', 'id' => (string) $e->id, 'date' => Carbon::parse($e->spent_on)->format('Y-m-d'), 'at' => (string) $e->created_at,
                'label' => (string) $e->number, 'party' => $e->payee, 'category' => (string) $e->category, 'description' => $e->description, 'in_minor' => 0, 'out_minor' => (int) $e->amount_minor];
        }
        foreach (DB::table('cash_transfers as t')->join('cash_accounts as fa', 'fa.id', '=', 't.from_account_id')->join('cash_accounts as ta', 'ta.id', '=', 't.to_account_id')
            ->whereNull('t.voided_at')->where(fn ($q) => $q->where('t.from_account_id', $id)->orWhere('t.to_account_id', $id))
            ->whereBetween('t.transferred_on', [$from, $to])
            ->get(['t.id', 't.transferred_on', 't.created_at', 't.amount_minor', 't.note', 't.from_account_id', 'fa.name as from_name', 'ta.name as to_name']) as $t) {
            $outgoing = (string) $t->from_account_id === $id;
            $entries[] = ['kind' => $outgoing ? 'TRANSFER_OUT' : 'TRANSFER_IN', 'id' => (string) $t->id, 'date' => Carbon::parse($t->transferred_on)->format('Y-m-d'), 'at' => (string) $t->created_at,
                'label' => $outgoing ? (string) $t->to_name : (string) $t->from_name, 'description' => $t->note,
                'in_minor' => $outgoing ? 0 : (int) $t->amount_minor, 'out_minor' => $outgoing ? (int) $t->amount_minor : 0];
        }
        foreach (DB::table('cash_closings as c')->leftJoin('users as u', 'u.id', '=', 'c.closed_by')->where('c.cash_account_id', $id)->whereBetween('c.day', [$from, $to])
            ->get(['c.id', 'c.day', 'c.created_at', 'c.expected_minor', 'c.counted_minor', 'c.difference_minor', 'c.note', 'u.full_name as by']) as $c) {
            $diff = (int) $c->difference_minor;
            $entries[] = ['kind' => 'CLOSING', 'id' => (string) $c->id, 'date' => Carbon::parse($c->day)->format('Y-m-d'), 'at' => '9999', // a day's count closes it: last
                'label' => $c->by, 'description' => $c->note, 'expected_minor' => (int) $c->expected_minor, 'counted_minor' => (int) $c->counted_minor,
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
        $adjust = (int) DB::table('cash_closings')->where('cash_account_id', $accountId)->whereBetween('day', [$from, $to])->sum('difference_minor');

        return ['in' => $in + $tin, 'out' => $out + $tout, 'adjust' => $adjust];
    }

    private function timezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
    }
}
