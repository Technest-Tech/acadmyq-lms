<?php

declare(strict_types=1);

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The platform owner's own income book (see the `finance_ledger` migration).
 *
 * THE one place that knows how a deal's money adds up. Every screen — dues, contracts, an
 * account, the client page, payments, the dashboard — reads its figures through here so
 * "outstanding" means the same number everywhere. Since the accounts unification (2026-11-08) this
 * is the platform's ONLY money book: a book client may be a platform client (`linked_academy_id`), and
 * the old per-module bills (`academy_invoices`) are no longer written.
 *
 * The one idea: a payment is money against a DEAL, and coverage flows down the schedule oldest
 * due first (a waterfall). So a 5,000 sale split 2,000 / 3,000 with 4,000 received is "first
 * installment paid, 2,000 left on the second" without anyone allocating anything. A subscription
 * owes every cycle that has started (paid or not) plus, once those are covered, the one open
 * cycle that says when the next payment falls due; a payment for three cycles rolls three.
 *
 * All money is integer minor units per deal currency; the ledger never converts between
 * currencies, so every aggregate is grouped by currency and the screen shows one figure per.
 */
final class FinanceLedger
{
    public const SERVICES = ['COURSE_SITE', 'MANAGEMENT_SYSTEM', 'VIDEO_PLATFORM', 'WHATSAPP_SERVICE', 'CUSTOM_WORK', 'HOSTING', 'SUPPORT', 'OTHER'];

    public const KINDS = ['ONE_TIME', 'SUBSCRIPTION'];

    public const INTERVALS = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY'];

    /** Months in one cycle of each interval. */
    public const INTERVAL_MONTHS = ['MONTHLY' => 1, 'QUARTERLY' => 3, 'SEMI_ANNUAL' => 6, 'YEARLY' => 12];

    public const STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];

    public const METHODS = ['CASH', 'BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH', 'PAYPAL', 'CARD', 'OTHER'];

    public const CURRENCIES = ['EGP', 'USD', 'SAR', 'AED', 'EUR', 'GBP'];

    /** The most cycles one payment may roll a subscription forward — ten years of monthly. */
    private const MAX_ROLL = 120;

    /**
     * The waterfall, as SQL. `inst` numbers each installment with the running total of its deal's
     * schedule; `pay` is what the deal has received; `dues` is what is still owed on each
     * installment after the received money has flowed down the schedule oldest-first.
     *
     * Usable as the head of any query: `WITH … dues AS (…) SELECT … FROM dues …`.
     */
    private const DUES_CTE = <<<'SQL'
        with inst as (
          select i.id, i.deal_id, i.seq, i.due_on, i.amount_minor, i.note,
                 sum(i.amount_minor) over (
                   partition by i.deal_id
                   order by i.due_on, i.seq, i.id
                   rows between unbounded preceding and current row
                 ) as cum_minor
          from finance_installments i
        ),
        pay as (
          select deal_id,
                 sum(amount_minor)::bigint as paid_minor,
                 max(paid_on) as last_paid_on
          from finance_payments
          group by deal_id
        ),
        dues as (
          select inst.id, inst.deal_id, inst.seq, inst.due_on, inst.amount_minor, inst.note,
                 inst.cum_minor,
                 coalesce(pay.paid_minor, 0)::bigint as deal_paid_minor,
                 greatest(0, least(inst.amount_minor, inst.cum_minor - coalesce(pay.paid_minor, 0)))::bigint as remaining_minor
          from inst
          left join pay on pay.deal_id = inst.deal_id
        )
        SQL;

    /**
     * Every deal with its client name and derived money columns. Wrapped as a subquery so the
     * DataTable engine can search/filter/sort on the derived columns as if they were stored.
     */
    private const DEALS_SQL = self::DUES_CTE.<<<'SQL'
        ,
        cover as (
          select dues.deal_id,
                 sum(dues.amount_minor)::bigint as scheduled_minor,
                 sum(dues.remaining_minor)::bigint as outstanding_minor,
                 sum(case when dues.due_on < current_date then dues.remaining_minor else 0 end)::bigint as overdue_minor,
                 min(case when dues.remaining_minor > 0 then dues.due_on end) as next_due_on,
                 min(case when dues.remaining_minor > 0 then dues.remaining_minor end)::bigint as next_due_minor
          from dues
          group by dues.deal_id
        )
        select d.id, d.client_id, c.name as client_name, c.linked_academy_id as academy_id, c.plan, d.title, d.service, d.kind, d.billing_interval,
               d.amount_minor, d.list_amount_minor, d.currency, d.started_on, d.ends_on, d.status, d.notes, d.created_at, d.updated_at,
               coalesce(cover.scheduled_minor, 0)::bigint as scheduled_minor,
               coalesce(pay.paid_minor, 0)::bigint as paid_minor,
               coalesce(cover.outstanding_minor, 0)::bigint as outstanding_minor,
               coalesce(cover.overdue_minor, 0)::bigint as overdue_minor,
               cover.next_due_on,
               coalesce(cover.next_due_minor, 0)::bigint as next_due_minor,
               pay.last_paid_on
        from finance_deals d
        join finance_clients c on c.id = d.client_id
        left join cover on cover.deal_id = d.id
        left join pay on pay.deal_id = d.id
        SQL;

    /** Every payment with its deal and client, for the ledger screen. */
    private const PAYMENTS_SQL = <<<'SQL'
        select p.id, p.deal_id, p.paid_on, p.amount_minor, p.method, p.reference, p.note, p.created_at,
               d.title as deal_title, d.service, d.kind, d.currency, d.client_id, c.name as client_name,
               to_char(p.paid_on, 'YYYY-MM') as month
        from finance_payments p
        join finance_deals d on d.id = p.deal_id
        join finance_clients c on c.id = d.client_id
        SQL;

    /** Every client with deal counts and per-currency received / outstanding maps (jsonb). */
    /**
     * Every account (the "contracts" list): who pays, the agreement, what is owed and when. One row
     * per client — a platform client links to its academy (`academy_id`), a client off our servers
     * does not. `rec_*` is the recurring line the agreement manages (the oldest active subscription);
     * `next_due_*` is the soonest money still owed on any active deal.
     */
    private const CLIENTS_SQL = self::DUES_CTE.<<<'SQL'
        select c.id, c.name, c.phone, c.email, c.notes, c.created_at, c.updated_at,
               c.linked_academy_id as academy_id, c.plan, c.pay_token,
               a.name as academy_name, a.status as academy_status, a.client_type,
               rec.id as rec_deal_id, rec.amount_minor as rec_amount_minor, rec.list_amount_minor as rec_list_amount_minor,
               rec.billing_interval as rec_interval, rec.currency as rec_currency, rec.service as rec_service,
               nd.due_on as next_due_on, nd.remaining_minor as next_due_minor, nd.currency as next_due_currency,
               exists (
                 select 1 from dues join finance_deals d on d.id = dues.deal_id
                 where d.client_id = c.id and d.status = 'ACTIVE' and dues.remaining_minor > 0 and dues.due_on < current_date
               ) as has_overdue,
               (select coalesce(jsonb_object_agg(x.currency, x.s), '{}'::jsonb)
                  from (select d.currency, sum(dues.remaining_minor)::bigint as s
                          from dues join finance_deals d on d.id = dues.deal_id
                         where d.client_id = c.id and d.status = 'ACTIVE' and dues.due_on < current_date
                         group by d.currency) x) as overdue,
               (select count(*) from finance_payment_submissions s where s.client_id = c.id and s.status = 'PENDING')::int as pending_proofs,
               (select count(*) from finance_deals d where d.client_id = c.id)::int as deals_count,
               (select count(*) from finance_deals d where d.client_id = c.id and d.status = 'ACTIVE')::int as active_deals,
               (select coalesce(jsonb_object_agg(x.currency, x.s), '{}'::jsonb)
                  from (select d.currency, sum(p.amount_minor)::bigint as s
                          from finance_payments p join finance_deals d on d.id = p.deal_id
                         where d.client_id = c.id group by d.currency) x) as received,
               (select coalesce(jsonb_object_agg(x.currency, x.s), '{}'::jsonb)
                  from (select d.currency, sum(dues.remaining_minor)::bigint as s
                          from dues join finance_deals d on d.id = dues.deal_id
                         where d.client_id = c.id and d.status = 'ACTIVE' group by d.currency) x) as outstanding,
               (select max(p.paid_on) from finance_payments p join finance_deals d on d.id = p.deal_id
                 where d.client_id = c.id) as last_paid_on
        from finance_clients c
        left join academies a on a.id = c.linked_academy_id
        left join lateral (
          select d.id, d.amount_minor, d.list_amount_minor, d.billing_interval, d.currency, d.service
          from finance_deals d
          where d.client_id = c.id and d.kind = 'SUBSCRIPTION' and d.status = 'ACTIVE'
          -- the running line, not one that is only winding down its last dues
          order by (d.ends_on is not null), d.started_on, d.created_at
          limit 1
        ) rec on true
        left join lateral (
          select dues.due_on, dues.remaining_minor, d.currency
          from dues join finance_deals d on d.id = dues.deal_id
          where d.client_id = c.id and d.status = 'ACTIVE' and dues.remaining_minor > 0
          order by dues.due_on, dues.seq
          limit 1
        ) nd on true
        SQL;

    /** Every open due on an active deal, with who owes it — the Dues screen and the reminders. */
    private const OPEN_DUES_SQL = self::DUES_CTE.<<<'SQL'
        select dues.id, dues.deal_id, dues.seq, dues.due_on, dues.amount_minor, dues.remaining_minor,
               d.title, d.service, d.kind, d.billing_interval, d.currency,
               c.id as client_id, c.name as client_name, c.linked_academy_id as academy_id, c.plan, c.phone, c.pay_token,
               a.name as academy_name,
               (current_date - dues.due_on)::int as days_late
        from dues
        join finance_deals d on d.id = dues.deal_id
        join finance_clients c on c.id = d.client_id
        left join academies a on a.id = c.linked_academy_id
        where d.status = 'ACTIVE' and dues.remaining_minor > 0
        SQL;

    // ── Queries the list screens paginate ────────────────────────────────────

    public function dealsQuery(): Builder
    {
        return DB::query()->fromSub(self::DEALS_SQL, 'd');
    }

    public function paymentsQuery(): Builder
    {
        return DB::query()->fromSub(self::PAYMENTS_SQL, 'p');
    }

    public function clientsQuery(): Builder
    {
        return DB::query()->fromSub(self::CLIENTS_SQL, 'c');
    }

    // ── One deal ─────────────────────────────────────────────────────────────

    /** The deal row with its derived money columns, or null. */
    public function deal(string $id): ?object
    {
        $row = $this->dealsQuery()->where('id', $id)->first();

        return $row === null ? null : $this->normalizeDeal($row);
    }

    /**
     * The schedule with the waterfall applied: each installment's paid / remaining and a status
     * the screen can colour — PAID, OVERDUE (money owed past its date), PARTIAL, PENDING.
     *
     * @return list<object>
     */
    public function schedule(string $dealId): array
    {
        $rows = DB::select(self::DUES_CTE.' select * from dues where deal_id = ? order by due_on, seq, id', [$dealId]);
        $today = $this->today();

        return array_map(function (object $row) use ($today): object {
            $amount = (int) $row->amount_minor;
            $remaining = (int) $row->remaining_minor;

            return (object) [
                'id' => $row->id,
                'deal_id' => $row->deal_id,
                'seq' => (int) $row->seq,
                'due_on' => (string) $row->due_on,
                'amount_minor' => $amount,
                'paid_minor' => $amount - $remaining,
                'remaining_minor' => $remaining,
                'note' => $row->note,
                'status' => match (true) {
                    $remaining === 0 => 'PAID',
                    (string) $row->due_on < $today => 'OVERDUE',
                    $remaining < $amount => 'PARTIAL',
                    default => 'PENDING',
                },
            ];
        }, $rows);
    }

    /** @return Collection<int,object> the deal's payments, newest first. */
    public function payments(string $dealId): Collection
    {
        return DB::table('finance_payments')
            ->where('deal_id', $dealId)
            ->orderByDesc('paid_on')
            ->orderByDesc('id')
            ->get()
            ->map(fn (object $p): object => $this->normalizePayment($p));
    }

    // ── Writes ───────────────────────────────────────────────────────────────

    /**
     * Create a deal with its schedule. ONE_TIME: the given installments (or one, due on the start
     * date, for the whole amount) — the deal total IS their sum. SUBSCRIPTION: the first cycle,
     * due on the start date; later cycles are rolled in as each one is settled.
     *
     * @param  array<string,mixed>  $deal  validated columns of finance_deals
     * @param  list<array{due_on:string,amount_minor:int,note?:?string}>  $installments
     */
    public function createDeal(array $deal, array $installments = []): string
    {
        return DB::transaction(function () use ($deal, $installments): string {
            if ($deal['kind'] === 'ONE_TIME' && $installments !== []) {
                $deal['amount_minor'] = array_sum(array_map(fn (array $i): int => (int) $i['amount_minor'], $installments));
            }
            if ($deal['kind'] === 'SUBSCRIPTION' || $installments === []) {
                $installments = [['due_on' => $deal['started_on'], 'amount_minor' => (int) $deal['amount_minor'], 'note' => null]];
            }

            $id = (string) DB::table('finance_deals')->insertGetId(
                ['id' => DB::raw('uuid_generate_v7()')] + $deal,
                'id',
            );
            $this->writeSchedule($id, $installments);

            return $id;
        });
    }

    /**
     * Replace a deal's schedule wholesale. Payments are untouched — the waterfall simply re-flows
     * over the new dates and amounts. For a one-time sale the deal total follows the schedule.
     *
     * @param  list<array{due_on:string,amount_minor:int,note?:?string}>  $installments
     */
    public function replaceSchedule(string $dealId, array $installments): void
    {
        DB::transaction(function () use ($dealId, $installments): void {
            $deal = DB::table('finance_deals')->where('id', $dealId)->lockForUpdate()->first();
            if ($deal === null) {
                return;
            }

            DB::table('finance_installments')->where('deal_id', $dealId)->delete();
            $this->writeSchedule($dealId, $installments);

            if ($deal->kind === 'ONE_TIME') {
                $total = array_sum(array_map(fn (array $i): int => (int) $i['amount_minor'], $installments));
                DB::table('finance_deals')->where('id', $dealId)
                    ->update(['amount_minor' => $total, 'updated_at' => DB::raw('now()')]);
            }

            $this->settle($dealId);
        });
    }

    /**
     * Record money received. Afterwards a subscription rolls its next cycle(s) in and a one-time
     * sale that is now fully covered marks itself COMPLETED.
     *
     * @param  array<string,mixed>  $payment  validated columns of finance_payments (no deal_id)
     */
    public function recordPayment(string $dealId, array $payment): string
    {
        return DB::transaction(function () use ($dealId, $payment): string {
            $id = (string) DB::table('finance_payments')->insertGetId(
                ['id' => DB::raw('uuid_generate_v7()'), 'deal_id' => $dealId] + $payment,
                'id',
            );

            $this->settle($dealId, completeWhenCovered: true);

            return $id;
        });
    }

    /** Remove a payment. A one-time sale marked COMPLETED by the ledger reopens if money is owed again. */
    public function deletePayment(string $paymentId): ?string
    {
        return DB::transaction(function () use ($paymentId): ?string {
            $dealId = DB::table('finance_payments')->where('id', $paymentId)->value('deal_id');
            if ($dealId === null) {
                return null;
            }
            DB::table('finance_payments')->where('id', $paymentId)->delete();

            $summary = $this->deal((string) $dealId);
            if ($summary !== null && $summary->kind === 'ONE_TIME' && $summary->status === 'COMPLETED' && $summary->outstanding_minor > 0) {
                DB::table('finance_deals')->where('id', $dealId)
                    ->update(['status' => 'ACTIVE', 'updated_at' => DB::raw('now()')]);
            }

            return (string) $dealId;
        });
    }

    /**
     * Bring a deal's derived state in line with its money: an ACTIVE subscription always has an
     * open cycle (rolling as many as the received money covers), and — when asked — a one-time
     * sale that is fully covered becomes COMPLETED. Safe to call any time.
     */
    public function settle(string $dealId, bool $completeWhenCovered = false): void
    {
        $deal = DB::table('finance_deals')->where('id', $dealId)->first();
        if ($deal === null) {
            return;
        }

        if ($deal->kind === 'SUBSCRIPTION' && $deal->status === 'ACTIVE' && (int) $deal->amount_minor > 0) {
            $today = CarbonImmutable::parse($this->today());
            $anchor = CarbonImmutable::parse((string) $deal->started_on);
            for ($i = 0; $i < self::MAX_ROLL; $i++) {
                $last = DB::table('finance_installments')->where('deal_id', $dealId)
                    ->orderByDesc('due_on')->orderByDesc('seq')->first();
                $due = $last === null
                    ? $anchor
                    : $this->advance(CarbonImmutable::parse((string) $last->due_on), (string) $deal->billing_interval, $anchor->day);

                // An ended subscription owes nothing that starts on or after its end.
                if ($deal->ends_on !== null && $due->toDateString() >= (string) $deal->ends_on) {
                    break;
                }
                // A cycle is owed from the day it starts, paid or not: a client on our servers who
                // has not paid for three months owes three months, not one. Beyond today, a cycle is
                // rolled in only when everything before it is covered — the one open cycle that
                // says when the next payment falls due.
                if ($last !== null && $due->greaterThan($today) && $this->outstandingOf($dealId) > 0) {
                    break;
                }

                DB::table('finance_installments')->insert([
                    'id' => DB::raw('uuid_generate_v7()'),
                    'deal_id' => $dealId,
                    'seq' => ($last->seq ?? 0) + 1,
                    'due_on' => $due->toDateString(),
                    'amount_minor' => (int) $deal->amount_minor,
                ]);
            }
        }

        // A subscription past its end is finished the moment nothing is owed on it any more.
        if ($deal->kind === 'SUBSCRIPTION' && $deal->status === 'ACTIVE' && $deal->ends_on !== null
            && (string) $deal->ends_on <= $this->today() && $this->outstandingOf($dealId) === 0) {
            DB::table('finance_deals')->where('id', $dealId)
                ->update(['status' => 'COMPLETED', 'updated_at' => DB::raw('now()')]);
        }

        if ($completeWhenCovered && $deal->kind === 'ONE_TIME' && $deal->status === 'ACTIVE') {
            $summary = $this->deal($dealId);
            if ($summary !== null && $summary->scheduled_minor > 0 && $summary->outstanding_minor === 0) {
                DB::table('finance_deals')->where('id', $dealId)
                    ->update(['status' => 'COMPLETED', 'updated_at' => DB::raw('now()')]);
            }
        }
    }

    /** Roll every active subscription up to today (the nightly job; also safe to run any time). */
    public function accrueAll(): int
    {
        $ids = DB::table('finance_deals')
            ->where('kind', 'SUBSCRIPTION')
            ->where('status', 'ACTIVE')
            ->pluck('id');
        foreach ($ids as $id) {
            $this->settle((string) $id);
        }

        return $ids->count();
    }

    /** What is still owed on a deal, all cycles together (the waterfall's total, without the rows). */
    public function outstandingOf(string $dealId): int
    {
        $row = DB::selectOne(
            'select coalesce((select sum(amount_minor) from finance_installments where deal_id = ?), 0)
                  - coalesce((select sum(amount_minor) from finance_payments where deal_id = ?), 0) as owed',
            [$dealId, $dealId],
        );

        return max(0, (int) ($row->owed ?? 0));
    }

    // ── Accounts (one client: the agreement, the dues, the money) ───────────

    /**
     * Open dues on active deals falling due on or before today + $horizonDays, oldest first.
     *
     * @return list<object>
     */
    public function openDues(int $horizonDays = 31, ?string $clientId = null): array
    {
        $sql = self::OPEN_DUES_SQL.' and dues.due_on <= current_date + ?::int';
        $bindings = [$horizonDays];
        if ($clientId !== null) {
            $sql .= ' and c.id = ?';
            $bindings[] = $clientId;
        }
        $sql .= ' order by dues.due_on, c.name, dues.seq';

        return array_map(function (object $r): object {
            foreach (['seq', 'amount_minor', 'remaining_minor', 'days_late'] as $col) {
                $r->$col = (int) $r->$col;
            }
            $r->due_on = (string) $r->due_on;

            return $r;
        }, DB::select($sql, $bindings));
    }

    /** One account row (the contracts list's shape), or null. */
    public function account(string $clientId): ?object
    {
        $row = $this->clientsQuery()->where('id', $clientId)->first();

        return $row === null ? null : $this->normalizeClient($row);
    }

    /**
     * Everything one account's page shows: the row, every deal with its schedule, every payment
     * (newest first, with the deal it landed on) and the proofs the client uploaded.
     *
     * @return array<string,mixed>|null
     */
    public function accountPayload(string $clientId): ?array
    {
        $account = $this->account($clientId);
        if ($account === null) {
            return null;
        }

        $deals = $this->dealsQuery()
            ->where('client_id', $clientId)
            // Live money first, then the history.
            ->orderByRaw("case status when 'ACTIVE' then 0 when 'COMPLETED' then 1 else 2 end")
            ->orderBy('kind')
            ->orderBy('started_on')
            ->get()
            ->map(function (object $row): object {
                $deal = $this->normalizeDeal($row);
                $deal->schedule = $this->schedule((string) $deal->id);

                return $deal;
            })
            ->all();

        $payments = $this->paymentsQuery()
            ->where('client_id', $clientId)
            ->orderByDesc('paid_on')
            ->orderByDesc('id')
            ->get()
            ->map(fn (object $p): object => $this->normalizePayment($p))
            ->all();

        return [
            'account' => $account,
            'deals' => $deals,
            'payments' => $payments,
            'submissions' => $this->submissions($clientId),
        ];
    }

    /** @return list<object> a client's payment proofs (or every pending one), newest first. */
    public function submissions(?string $clientId = null, bool $pendingOnly = false): array
    {
        $q = DB::table('finance_payment_submissions as s')
            ->join('finance_clients as c', 'c.id', '=', 's.client_id')
            ->leftJoin('academies as a', 'a.id', '=', 'c.linked_academy_id')
            ->select('s.id', 's.client_id', 's.method', 's.amount_minor', 's.currency', 's.note', 's.status',
                's.reviewed_at', 's.created_at', 'c.name as client_name', 'c.linked_academy_id as academy_id', 'a.name as academy_name')
            ->orderByDesc('s.created_at');
        if ($clientId !== null) {
            $q->where('s.client_id', $clientId);
        }
        if ($pendingOnly) {
            $q->where('s.status', 'PENDING');
        }

        return $q->get()->map(function (object $s): object {
            $s->amount_minor = $s->amount_minor === null ? null : (int) $s->amount_minor;
            $s->created_at = CarbonImmutable::parse((string) $s->created_at)->toIso8601String();
            $s->reviewed_at = $s->reviewed_at === null ? null : CarbonImmutable::parse((string) $s->reviewed_at)->toIso8601String();

            return $s;
        })->all();
    }

    /**
     * Money received from a CLIENT rather than against one deal (a proof, or "he paid 3,000"):
     * spread over that client's open dues in the currency, oldest first across all its active
     * deals; anything left over is paid ahead on the recurring line (which rolls its cycles), or
     * failing that sits on the newest active deal. Returns the payment ids it wrote.
     *
     * @param  array{paid_on:string,amount_minor:int,method:string,reference?:?string,note?:?string,submission_id?:?string}  $payment
     * @return list<string>
     */
    public function receiveFromClient(string $clientId, string $currency, array $payment): array
    {
        return DB::transaction(function () use ($clientId, $currency, $payment): array {
            $left = (int) $payment['amount_minor'];
            $shares = [];

            foreach ($this->openDues(36500, $clientId) as $due) {
                if ($left <= 0) {
                    break;
                }
                if ($due->currency !== $currency) {
                    continue;
                }
                $take = min($left, $due->remaining_minor);
                $shares[$due->deal_id] = ($shares[$due->deal_id] ?? 0) + $take;
                $left -= $take;
            }

            if ($left > 0) {
                $ahead = DB::table('finance_deals')
                    ->where('client_id', $clientId)
                    ->where('status', 'ACTIVE')
                    ->where('currency', $currency)
                    ->orderByRaw("case kind when 'SUBSCRIPTION' then 0 else 1 end")
                    ->orderBy('started_on')
                    ->value('id')
                    ?? DB::table('finance_deals')
                        ->where('client_id', $clientId)
                        ->where('currency', $currency)
                        ->orderByDesc('started_on')
                        ->value('id');
                if ($ahead === null) {
                    throw ValidationException::withMessages([
                        'amount_minor' => "This client has nothing in {$currency} to pay against.",
                    ]);
                }
                $shares[(string) $ahead] = ($shares[(string) $ahead] ?? 0) + $left;
            }

            $ids = [];
            foreach ($shares as $dealId => $amount) {
                $ids[] = $this->recordPayment((string) $dealId, [
                    'paid_on' => $payment['paid_on'],
                    'amount_minor' => $amount,
                    'method' => $payment['method'],
                    'reference' => $payment['reference'] ?? null,
                    'note' => $payment['note'] ?? null,
                    'submission_id' => $payment['submission_id'] ?? null,
                ]);
            }

            return $ids;
        });
    }

    /**
     * The money facts of every PLATFORM client's account, keyed by academy id — merged into the
     * clients roster and the client page so their clocks read the book, not the module periods.
     *
     * @param  list<string>|null  $academyIds  null = all linked accounts
     * @return array<string, array<string,mixed>>
     */
    public function summariesByAcademy(?array $academyIds = null): array
    {
        $q = $this->clientsQuery()->whereNotNull('academy_id');
        if ($academyIds !== null) {
            if ($academyIds === []) {
                return [];
            }
            $q->whereIn('academy_id', $academyIds);
        }

        $out = [];
        foreach ($q->get() as $row) {
            $out[(string) $row->academy_id] = $this->summaryOf($this->normalizeClient($row));
        }

        return $out;
    }

    /** The compact account shape the client screens read. @return array<string,mixed> */
    public function summaryOf(object $account): array
    {
        return [
            'id' => $account->id,
            'plan' => $account->plan,
            'pay_token' => $account->pay_token,
            'recurring' => $account->rec_deal_id === null ? null : [
                'deal_id' => $account->rec_deal_id,
                'amount_minor' => $account->rec_amount_minor,
                'list_amount_minor' => $account->rec_list_amount_minor,
                'interval' => $account->rec_interval,
                'currency' => $account->rec_currency,
            ],
            'next_due_on' => $account->next_due_on,
            'next_due_minor' => $account->next_due_minor,
            'next_due_currency' => $account->next_due_currency,
            'has_overdue' => $account->has_overdue,
            'overdue' => $account->overdue,
            'outstanding' => $account->outstanding,
            'pending_proofs' => $account->pending_proofs,
            'active_deals' => $account->active_deals,
        ];
    }

    // ── Overview ─────────────────────────────────────────────────────────────

    /**
     * Everything the overview screen shows, computed in the database in a handful of grouped
     * queries. Money is per currency throughout; the screen renders one figure per currency.
     *
     * @return array<string,mixed>
     */
    public function overview(): array
    {
        $totals = [];
        $bucket = function (string $currency) use (&$totals): void {
            $totals[$currency] ??= [
                'currency' => $currency,
                'month_minor' => 0, 'year_minor' => 0, 'total_minor' => 0,
                'outstanding_minor' => 0, 'overdue_minor' => 0, 'upcoming_minor' => 0,
                'mrr_minor' => 0, 'subscriptions' => 0,
            ];
        };

        foreach (DB::select(<<<'SQL'
            select d.currency,
                   sum(case when p.paid_on >= date_trunc('month', current_date) then p.amount_minor else 0 end)::bigint as month_minor,
                   sum(case when p.paid_on >= date_trunc('year', current_date) then p.amount_minor else 0 end)::bigint as year_minor,
                   sum(p.amount_minor)::bigint as total_minor
            from finance_payments p join finance_deals d on d.id = p.deal_id
            group by d.currency
            SQL) as $row) {
            $bucket($row->currency);
            $totals[$row->currency]['month_minor'] = (int) $row->month_minor;
            $totals[$row->currency]['year_minor'] = (int) $row->year_minor;
            $totals[$row->currency]['total_minor'] = (int) $row->total_minor;
        }

        foreach (DB::select(self::DUES_CTE.<<<'SQL'
            select d.currency,
                   sum(dues.remaining_minor)::bigint as outstanding_minor,
                   sum(case when dues.due_on < current_date then dues.remaining_minor else 0 end)::bigint as overdue_minor,
                   sum(case when dues.due_on >= current_date and dues.due_on < current_date + 30 then dues.remaining_minor else 0 end)::bigint as upcoming_minor
            from dues join finance_deals d on d.id = dues.deal_id
            where d.status = 'ACTIVE'
            group by d.currency
            SQL) as $row) {
            $bucket($row->currency);
            $totals[$row->currency]['outstanding_minor'] = (int) $row->outstanding_minor;
            $totals[$row->currency]['overdue_minor'] = (int) $row->overdue_minor;
            $totals[$row->currency]['upcoming_minor'] = (int) $row->upcoming_minor;
        }

        foreach (DB::select(<<<'SQL'
            select currency,
                   sum(case billing_interval
                         when 'MONTHLY' then amount_minor
                         when 'QUARTERLY' then amount_minor / 3
                         when 'SEMI_ANNUAL' then amount_minor / 6
                         when 'YEARLY' then amount_minor / 12
                         else 0 end)::bigint as mrr_minor,
                   count(*)::int as subscriptions
            from finance_deals
            where kind = 'SUBSCRIPTION' and status = 'ACTIVE'
            group by currency
            SQL) as $row) {
            $bucket($row->currency);
            $totals[$row->currency]['mrr_minor'] = (int) $row->mrr_minor;
            $totals[$row->currency]['subscriptions'] = (int) $row->subscriptions;
        }

        $counts = DB::selectOne(self::DUES_CTE.<<<'SQL'
            select (select count(*) from finance_clients)::int as clients,
                   (select count(*) from finance_deals where status = 'ACTIVE')::int as active_deals,
                   (select count(*) from finance_deals where status = 'ACTIVE' and kind = 'SUBSCRIPTION')::int as active_subscriptions,
                   (select count(distinct dues.deal_id) from dues join finance_deals d on d.id = dues.deal_id
                     where d.status = 'ACTIVE' and dues.due_on < current_date and dues.remaining_minor > 0)::int as overdue_deals
            SQL);

        $byService = DB::select(<<<'SQL'
            select d.service, d.currency, sum(p.amount_minor)::bigint as amount_minor
            from finance_payments p join finance_deals d on d.id = p.deal_id
            where p.paid_on >= date_trunc('year', current_date)
            group by d.service, d.currency
            order by 3 desc
            SQL);

        $monthly = DB::select(<<<'SQL'
            select to_char(date_trunc('month', p.paid_on), 'YYYY-MM') as month, d.currency, sum(p.amount_minor)::bigint as amount_minor
            from finance_payments p join finance_deals d on d.id = p.deal_id
            where p.paid_on >= date_trunc('month', current_date) - interval '11 months'
            group by 1, 2
            order by 1
            SQL);

        $upcoming = DB::select(self::DUES_CTE.<<<'SQL'
            select dues.id, dues.deal_id, dues.due_on, dues.amount_minor, dues.remaining_minor,
                   d.title, d.service, d.kind, d.currency, c.name as client_name,
                   (dues.due_on < current_date) as overdue
            from dues
            join finance_deals d on d.id = dues.deal_id
            join finance_clients c on c.id = d.client_id
            where d.status = 'ACTIVE' and dues.remaining_minor > 0
            order by dues.due_on, dues.seq
            limit 12
            SQL);

        $recent = DB::select(self::PAYMENTS_SQL.' order by p.paid_on desc, p.id desc limit 8');

        return [
            'today' => $this->today(),
            'totals' => array_values($totals),
            'counts' => [
                'clients' => (int) ($counts->clients ?? 0),
                'active_deals' => (int) ($counts->active_deals ?? 0),
                'active_subscriptions' => (int) ($counts->active_subscriptions ?? 0),
                'overdue_deals' => (int) ($counts->overdue_deals ?? 0),
            ],
            'by_service' => array_map(fn (object $r): array => [
                'service' => $r->service, 'currency' => $r->currency, 'amount_minor' => (int) $r->amount_minor,
            ], $byService),
            'monthly' => array_map(fn (object $r): array => [
                'month' => $r->month, 'currency' => $r->currency, 'amount_minor' => (int) $r->amount_minor,
            ], $monthly),
            'upcoming' => array_map(fn (object $r): array => [
                'id' => $r->id,
                'deal_id' => $r->deal_id,
                'due_on' => (string) $r->due_on,
                'amount_minor' => (int) $r->amount_minor,
                'remaining_minor' => (int) $r->remaining_minor,
                'title' => $r->title,
                'service' => $r->service,
                'kind' => $r->kind,
                'currency' => $r->currency,
                'client_name' => $r->client_name,
                'overdue' => (bool) $r->overdue,
            ], $upcoming),
            'recent_payments' => array_map(fn (object $r): object => $this->normalizePayment($r), $recent),
        ];
    }

    // ── Row shaping ──────────────────────────────────────────────────────────

    /** Cast the derived money columns to ints and dates to plain strings — one shape for every screen. */
    public function normalizeDeal(object $row): object
    {
        foreach (['amount_minor', 'scheduled_minor', 'paid_minor', 'outstanding_minor', 'overdue_minor', 'next_due_minor'] as $col) {
            $row->$col = (int) ($row->$col ?? 0);
        }
        $row->list_amount_minor = isset($row->list_amount_minor) ? (int) $row->list_amount_minor : null;
        foreach (['started_on', 'ends_on', 'next_due_on', 'last_paid_on'] as $col) {
            $row->$col = isset($row->$col) ? (string) $row->$col : null;
        }
        foreach (['created_at', 'updated_at'] as $col) {
            $row->$col = isset($row->$col) ? CarbonImmutable::parse((string) $row->$col)->toIso8601String() : null;
        }

        return $row;
    }

    public function normalizePayment(object $row): object
    {
        $row->amount_minor = (int) $row->amount_minor;
        $row->paid_on = (string) $row->paid_on;
        $row->created_at = isset($row->created_at) ? CarbonImmutable::parse((string) $row->created_at)->toIso8601String() : null;

        return $row;
    }

    public function normalizeClient(object $row): object
    {
        $row->deals_count = (int) ($row->deals_count ?? 0);
        $row->active_deals = (int) ($row->active_deals ?? 0);
        $row->pending_proofs = (int) ($row->pending_proofs ?? 0);
        $row->has_overdue = (bool) ($row->has_overdue ?? false);
        foreach (['rec_amount_minor', 'rec_list_amount_minor', 'next_due_minor'] as $col) {
            $row->$col = isset($row->$col) ? (int) $row->$col : null;
        }
        $row->next_due_on = isset($row->next_due_on) ? (string) $row->next_due_on : null;
        foreach (['academy_id', 'plan', 'pay_token', 'academy_name', 'academy_status', 'client_type', 'rec_deal_id', 'rec_interval', 'rec_currency', 'rec_service', 'next_due_currency'] as $col) {
            $row->$col ??= null;
        }
        foreach (['received', 'outstanding', 'overdue'] as $col) {
            $value = $row->$col ?? '{}';
            $row->$col = array_map('intval', is_string($value) ? (array) json_decode($value, true) : (array) $value);
        }
        $row->last_paid_on = isset($row->last_paid_on) ? (string) $row->last_paid_on : null;
        foreach (['created_at', 'updated_at'] as $col) {
            $row->$col = isset($row->$col) ? CarbonImmutable::parse((string) $row->$col)->toIso8601String() : null;
        }

        return $row;
    }

    /** The database's idea of today — the same `current_date` the SQL above compares against. */
    public function today(): string
    {
        return (string) DB::selectOne('select current_date::text as d')->d;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /** @param list<array{due_on:string,amount_minor:int,note?:?string}> $installments */
    private function writeSchedule(string $dealId, array $installments): void
    {
        usort($installments, fn (array $a, array $b): int => strcmp((string) $a['due_on'], (string) $b['due_on']));

        $rows = [];
        foreach (array_values($installments) as $i => $inst) {
            $rows[] = [
                'id' => DB::raw('uuid_generate_v7()'),
                'deal_id' => $dealId,
                'seq' => $i + 1,
                'due_on' => (string) $inst['due_on'],
                'amount_minor' => (int) $inst['amount_minor'],
                'note' => isset($inst['note']) && trim((string) $inst['note']) !== '' ? trim((string) $inst['note']) : null,
            ];
        }
        if ($rows !== []) {
            DB::table('finance_installments')->insert($rows);
        }
    }

    /**
     * The next cycle after `$from`, keeping the day-of-month the deal started on: a subscription
     * that began on the 31st is due on the 28th/29th of February and back on the 31st of March,
     * rather than drifting earlier every short month.
     */
    private function advance(CarbonImmutable $from, string $interval, int $anchorDay): CarbonImmutable
    {
        $months = self::INTERVAL_MONTHS[$interval] ?? 12;
        $next = $from->startOfMonth()->addMonths($months);

        return $next->setDay(min($anchorDay, $next->daysInMonth));
    }
}
