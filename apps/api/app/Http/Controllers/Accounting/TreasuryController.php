<?php

declare(strict_types=1);

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\Controller;
use App\Services\Ledger;
use App\Services\Treasury;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The treasury and the money out (docs/groups/01-ACCOUNTING.md) for an academy on `accounting`.
 *
 *   GET    /treasury                          every account with its balance today, the method map,
 *                                             the month's in / out / net, what still needs mapping
 *   POST   /treasury/accounts                 open an account (name, kind, currency, opening balance)
 *   PATCH  /treasury/accounts/{id}            rename / (de)activate
 *   PUT    /treasury/methods                  which account a payment method lands in
 *   GET    /treasury/accounts/{id}/ledger     the account's movements with a running balance
 *   POST   /treasury/transfers                move money between two accounts
 *   POST   /treasury/transfers/{id}/void
 *   POST   /treasury/closings                 close a day: counted vs expected
 *   DELETE /treasury/closings/{id}            reopen the account's LAST closed day
 *   GET    /expenses                          money out: filter by days, category, account
 *   POST   /expenses                          record one (a salary: with its payout statement)
 *   POST   /expenses/{id}/void
 *   GET    /expenses/{id}/attachment
 *   GET    /expenses/salaries                 finalized teacher statements and what is still unpaid
 *   POST   /expense-categories / PATCH /expense-categories/{id}
 *   GET    /accounting/income-expenses?year=  the year month by month: money in, money out, net
 *
 * Reading is `invoice.read`; writing `expense.manage`; closing a day `cashbox.close`; anything that
 * shows a teacher's pay additionally `payout.read`.
 */
final class TreasuryController extends Controller
{
    public function __construct(private readonly Treasury $treasury) {}

    // ── Accounts ────────────────────────────────────────────────────────────

    public function index(): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        $this->treasury->ensureCategories($academyId);
        $today = $this->today($academyId);
        $balances = $this->treasury->balances($academyId, $today);

        $lastClosings = DB::table('cash_closings')->orderByDesc('day')->get(['cash_account_id', 'day', 'difference_minor', 'counted_minor'])
            ->unique('cash_account_id')->keyBy(fn ($c) => (string) $c->cash_account_id);

        $accounts = DB::table('cash_accounts')->orderBy('sort_order')->orderBy('created_at')->get()->map(function ($a) use ($balances, $lastClosings, $today) {
            $b = $balances[(string) $a->id];
            $last = $lastClosings[(string) $a->id] ?? null;

            return [
                'id' => (string) $a->id,
                'name' => (string) $a->name,
                'kind' => (string) $a->kind,
                'currency' => (string) $a->currency,
                'opening_balance_minor' => (int) $a->opening_balance_minor,
                'opening_on' => Carbon::parse($a->opening_on)->format('Y-m-d'),
                'is_active' => (bool) $a->is_active,
                'balance_minor' => $b['balance_minor'],
                'today_in_minor' => $b['in_minor'],
                'today_out_minor' => $b['out_minor'],
                'last_closing' => $last !== null ? ['day' => Carbon::parse($last->day)->format('Y-m-d'), 'difference_minor' => (int) $last->difference_minor] : null,
                'closed_today' => $last !== null && Carbon::parse($last->day)->format('Y-m-d') === $today,
            ];
        })->values();

        $methods = DB::table('cash_account_methods')->get(['method', 'currency', 'cash_account_id'])
            ->map(fn ($m) => ['method' => (string) $m->method, 'currency' => (string) $m->currency, 'cash_account_id' => (string) $m->cash_account_id])->all();

        // Methods money actually arrives by (the last 90 days) that no account takes yet.
        $mapped = collect($methods)->map(fn ($m) => $m['method'].'|'.$m['currency'])->all();
        $unmapped = DB::table('receipts')->whereNull('voided_at')->whereNull('cash_account_id')
            ->where('received_on', '>=', Carbon::parse($today)->subDays(90)->format('Y-m-d'))
            ->distinct()->get(['method', 'currency'])
            ->filter(fn ($r) => ! in_array($r->method.'|'.$r->currency, $mapped, true))
            ->map(fn ($r) => ['method' => (string) $r->method, 'currency' => (string) $r->currency])->values()->all();

        [$from, $to] = [Carbon::parse($today)->startOfMonth()->format('Y-m-d'), $today];

        return response()->json([
            'today' => $today,
            'accounts' => $accounts,
            'methods' => $methods,
            'unmapped_methods' => $unmapped,
            'month' => $this->inOut($from, $to),
            'categories' => $this->categories(),
            'can_manage' => Gate::allows('expense.manage'),
            'can_close' => Gate::allows('cashbox.close'),
            'sees_salaries' => Gate::allows('payout.read'),
        ]);
    }

    public function storeAccount(Request $request): JsonResponse
    {
        Gate::authorize('expense.manage');
        $academyId = $this->academyId();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'kind' => ['required', Rule::in(Treasury::KINDS)],
            'currency' => ['nullable', 'string', 'size:3'],
            'opening_balance_minor' => ['nullable', 'integer', 'min:-100000000000', 'max:100000000000'],
            'opening_on' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.$this->today($academyId)],
            'methods' => ['nullable', 'array'],
            'methods.*' => [Rule::in(Ledger::METHODS)],
        ]);
        $currency = strtoupper((string) ($data['currency'] ?? DB::table('academies')->where('id', $academyId)->value('default_currency') ?? 'EGP'));

        $id = DB::transaction(function () use ($academyId, $data, $currency) {
            $id = (string) Str::uuid();
            DB::table('cash_accounts')->insert([
                'id' => $id,
                'academy_id' => $academyId,
                'name' => trim((string) $data['name']),
                'kind' => $data['kind'],
                'currency' => $currency,
                'opening_balance_minor' => (int) ($data['opening_balance_minor'] ?? 0),
                'opening_on' => $data['opening_on'] ?? $this->today($academyId),
                'sort_order' => (int) DB::table('cash_accounts')->count(),
            ]);
            foreach ($data['methods'] ?? [] as $method) {
                $this->mapMethod($academyId, (string) $method, $currency, $id);
            }

            return $id;
        });
        $this->audit('treasury.account_opened', 'cash_account', $id, ['name' => $data['name'], 'kind' => $data['kind'], 'opening_balance_minor' => (int) ($data['opening_balance_minor'] ?? 0)]);

        return response()->json(['id' => $id], 201);
    }

    public function updateAccount(Request $request, string $id): JsonResponse
    {
        Gate::authorize('expense.manage');
        $account = DB::table('cash_accounts')->where('id', $id)->first();
        if ($account === null) {
            abort(404, 'Account not found.');
        }
        $data = $request->validate(['name' => ['sometimes', 'string', 'max:80'], 'is_active' => ['sometimes', 'boolean']]);
        if (array_key_exists('is_active', $data) && ! $data['is_active']) {
            $balance = $this->treasury->balanceOf($account, $this->today((string) $account->academy_id))['balance_minor'];
            if ($balance !== 0) {
                throw ValidationException::withMessages(['is_active' => ['Move this account’s balance out before closing it. / انقل رصيد هذه الخزنة قبل إيقافها.']]);
            }
            DB::table('cash_account_methods')->where('cash_account_id', $id)->delete();
        }
        DB::table('cash_accounts')->where('id', $id)->update(array_filter([
            'name' => isset($data['name']) ? trim((string) $data['name']) : null,
            'is_active' => $data['is_active'] ?? null,
        ], fn ($v) => $v !== null) + ['updated_at' => now()]);
        $this->audit('treasury.account_updated', 'cash_account', $id, $data);

        return response()->json(['ok' => true]);
    }

    public function mapMethods(Request $request): JsonResponse
    {
        Gate::authorize('expense.manage');
        $academyId = $this->academyId();
        $data = $request->validate([
            'method' => ['required', Rule::in(Ledger::METHODS)],
            'currency' => ['required', 'string', 'size:3'],
            'cash_account_id' => ['nullable', 'uuid'],
        ]);
        $this->mapMethod($academyId, (string) $data['method'], strtoupper((string) $data['currency']), $data['cash_account_id'] ?? null);
        $this->audit('treasury.method_mapped', 'cash_account', $data['cash_account_id'] ?? null, $data);

        return response()->json(['ok' => true]);
    }

    public function ledger(Request $request, string $id): JsonResponse
    {
        Gate::authorize('invoice.read');
        $account = DB::table('cash_accounts')->where('id', $id)->first();
        if ($account === null) {
            abort(404, 'Account not found.');
        }
        $today = $this->today((string) $account->academy_id);
        $data = $request->validate(['from' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'to' => ['sometimes', 'nullable', 'date_format:Y-m-d']]);
        $to = $data['to'] ?? $today;
        $from = $data['from'] ?? Carbon::parse($to)->subDays(30)->format('Y-m-d');

        return response()->json([
            'account' => ['id' => (string) $account->id, 'name' => (string) $account->name, 'kind' => (string) $account->kind, 'currency' => (string) $account->currency,
                'opening_on' => Carbon::parse($account->opening_on)->format('Y-m-d')],
            'from' => max($from, Carbon::parse($account->opening_on)->format('Y-m-d')),
            'to' => $to,
        ] + $this->treasury->ledger($account, $from, $to));
    }

    // ── Transfers & closings ────────────────────────────────────────────────

    public function storeTransfer(Request $request): JsonResponse
    {
        Gate::authorize('expense.manage');
        $academyId = $this->academyId();
        $data = $request->validate([
            'from_account_id' => ['required', 'uuid', 'different:to_account_id'],
            'to_account_id' => ['required', 'uuid'],
            'amount_minor' => ['required', 'integer', 'min:1', 'max:100000000000'],
            'transferred_on' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.$this->today($academyId)],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $from = DB::table('cash_accounts')->where('id', $data['from_account_id'])->where('is_active', true)->first();
        $to = DB::table('cash_accounts')->where('id', $data['to_account_id'])->where('is_active', true)->first();
        if ($from === null || $to === null) {
            throw ValidationException::withMessages(['from_account_id' => ['Choose two open accounts. / اختر خزنتين مفعّلتين.']]);
        }
        if ($from->currency !== $to->currency) {
            throw ValidationException::withMessages(['to_account_id' => ['Both accounts must be in the same currency. / يجب أن تكون الخزنتان بنفس العملة.']]);
        }
        $on = $data['transferred_on'] ?? $this->today($academyId);
        $this->treasury->assertOpenDay((string) $from->id, $on);
        $this->treasury->assertOpenDay((string) $to->id, $on);

        $id = (string) Str::uuid();
        DB::table('cash_transfers')->insert([
            'id' => $id, 'academy_id' => $academyId, 'from_account_id' => $from->id, 'to_account_id' => $to->id,
            'amount_minor' => (int) $data['amount_minor'], 'transferred_on' => $on, 'note' => $data['note'] ?? null,
            'created_by' => app(AuthContext::class)->userId,
        ]);
        $this->audit('treasury.transfer', 'cash_transfer', $id, ['from' => $from->name, 'to' => $to->name, 'amount_minor' => (int) $data['amount_minor']]);

        return response()->json(['id' => $id], 201);
    }

    public function voidTransfer(Request $request, string $id): JsonResponse
    {
        Gate::authorize('expense.manage');
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);
        $t = DB::table('cash_transfers')->where('id', $id)->whereNull('voided_at')->first();
        if ($t === null) {
            abort(404, 'Transfer not found.');
        }
        $this->treasury->assertOpenDay((string) $t->from_account_id, (string) $t->transferred_on);
        $this->treasury->assertOpenDay((string) $t->to_account_id, (string) $t->transferred_on);
        DB::table('cash_transfers')->where('id', $id)->update(['voided_at' => now(), 'voided_by' => app(AuthContext::class)->userId, 'void_reason' => trim((string) $data['reason'])]);
        $this->audit('treasury.transfer_voided', 'cash_transfer', $id, ['reason' => $data['reason']]);

        return response()->json(['ok' => true]);
    }

    public function close(Request $request): JsonResponse
    {
        Gate::authorize('cashbox.close');
        $academyId = $this->academyId();
        $data = $request->validate([
            'cash_account_id' => ['required', 'uuid'],
            'day' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.$this->today($academyId)],
            'counted_minor' => ['required', 'integer', 'min:-100000000000', 'max:100000000000'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $account = DB::table('cash_accounts')->where('id', $data['cash_account_id'])->first();
        if ($account === null) {
            abort(404, 'Account not found.');
        }
        $day = $data['day'] ?? $this->today($academyId);
        if ($day < Carbon::parse($account->opening_on)->format('Y-m-d')) {
            throw ValidationException::withMessages(['day' => ['That day is before this account was opened. / هذا اليوم قبل فتح الخزنة.']]);
        }
        $this->treasury->assertOpenDay((string) $account->id, $day);

        return DB::transaction(function () use ($account, $day, $data, $academyId) {
            $expected = $this->treasury->balanceOf($account, $day)['balance_minor'];
            $counted = (int) $data['counted_minor'];
            $id = (string) Str::uuid();
            DB::table('cash_closings')->insert([
                'id' => $id, 'academy_id' => $academyId, 'cash_account_id' => $account->id, 'day' => $day,
                'expected_minor' => $expected, 'counted_minor' => $counted, 'difference_minor' => $counted - $expected,
                'note' => $data['note'] ?? null, 'closed_by' => app(AuthContext::class)->userId,
            ]);
            $this->audit('treasury.day_closed', 'cash_account', (string) $account->id, ['day' => $day, 'expected_minor' => $expected, 'counted_minor' => $counted]);

            return response()->json(['id' => $id, 'expected_minor' => $expected, 'counted_minor' => $counted, 'difference_minor' => $counted - $expected], 201);
        });
    }

    public function reopen(string $id): JsonResponse
    {
        Gate::authorize('cashbox.close');
        $c = DB::table('cash_closings')->where('id', $id)->first();
        if ($c === null) {
            abort(404, 'Closing not found.');
        }
        $latest = DB::table('cash_closings')->where('cash_account_id', $c->cash_account_id)->max('day');
        if (Carbon::parse($latest)->format('Y-m-d') !== Carbon::parse($c->day)->format('Y-m-d')) {
            throw ValidationException::withMessages(['closing' => ['Only the last closed day can be reopened. / يمكن إعادة فتح آخر يوم مُقفل فقط.']]);
        }
        DB::table('cash_closings')->where('id', $id)->delete();
        $this->audit('treasury.day_reopened', 'cash_account', (string) $c->cash_account_id, ['day' => $c->day, 'difference_minor' => (int) $c->difference_minor]);

        return response()->json(['ok' => true]);
    }

    // ── Expenses ────────────────────────────────────────────────────────────

    public function expenses(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        $this->treasury->ensureCategories($academyId);
        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'cash_account_id' => ['sometimes', 'nullable', 'uuid'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'void', 'all'])],
        ]);
        $today = $this->today($academyId);
        $from = $data['from'] ?? Carbon::parse($today)->startOfMonth()->format('Y-m-d');
        $to = $data['to'] ?? $today;
        $seesSalaries = Gate::allows('payout.read');
        $salaryKeys = ['teacher_salaries', 'staff_salaries'];

        $base = DB::table('expenses as e')
            ->join('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->join('cash_accounts as a', 'a.id', '=', 'e.cash_account_id')
            ->leftJoin('users as u', 'u.id', '=', 'e.created_by')
            ->whereBetween('e.spent_on', [$from, $to])
            ->when(! $seesSalaries, fn ($q) => $q->where(fn ($w) => $w->whereNull('c.key')->orWhereNotIn('c.key', $salaryKeys)))
            ->when(isset($data['category_id']), fn ($q) => $q->where('e.category_id', $data['category_id']))
            ->when(isset($data['cash_account_id']), fn ($q) => $q->where('e.cash_account_id', $data['cash_account_id']))
            ->when(isset($data['q']) && trim((string) $data['q']) !== '', function ($q) use ($data) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], trim((string) $data['q'])).'%';
                $q->where(fn ($w) => $w->where('e.number', 'ilike', $term)->orWhere('e.payee', 'ilike', $term)->orWhere('e.description', 'ilike', $term));
            });

        $byCategory = [];
        foreach ((clone $base)->whereNull('e.voided_at')->groupBy('c.id', 'c.name', 'e.currency')
            ->select(['c.id', 'c.name', 'e.currency', DB::raw('sum(e.amount_minor) as amount'), DB::raw('count(*) as n')])->get() as $r) {
            $byCategory[] = ['category_id' => (string) $r->id, 'name' => (string) $r->name, 'currency' => (string) $r->currency, 'amount_minor' => (int) $r->amount, 'count' => (int) $r->n];
        }
        usort($byCategory, fn ($a, $b) => $b['amount_minor'] <=> $a['amount_minor']);

        $status = $data['status'] ?? 'active';
        $rows = (clone $base)
            ->when($status === 'active', fn ($q) => $q->whereNull('e.voided_at'))
            ->when($status === 'void', fn ($q) => $q->whereNotNull('e.voided_at'))
            ->orderByDesc('e.spent_on')->orderByDesc('e.created_at')->limit(500)
            ->get(['e.*', 'c.name as category', 'c.key as category_key', 'a.name as account', 'u.full_name as created_by_name'])
            ->map(fn ($e) => [
                'id' => (string) $e->id,
                'number' => (string) $e->number,
                'spent_on' => Carbon::parse($e->spent_on)->format('Y-m-d'),
                'category_id' => (string) $e->category_id,
                'category' => (string) $e->category,
                'category_key' => $e->category_key,
                'amount_minor' => (int) $e->amount_minor,
                'currency' => (string) $e->currency,
                'cash_account_id' => (string) $e->cash_account_id,
                'account' => (string) $e->account,
                'payee' => $e->payee,
                'description' => $e->description,
                'has_attachment' => $e->attachment_path !== null,
                'payout_id' => $e->payout_id,
                'created_by_name' => $e->created_by_name,
                'voided' => $e->voided_at !== null,
                'void_reason' => $e->void_reason,
            ])->all();

        $totals = [];
        foreach ($byCategory as $c) {
            $totals[$c['currency']] ??= ['currency' => $c['currency'], 'amount_minor' => 0, 'count' => 0];
            $totals[$c['currency']]['amount_minor'] += $c['amount_minor'];
            $totals[$c['currency']]['count'] += $c['count'];
        }

        return response()->json([
            'from' => $from,
            'to' => $to,
            'expenses' => $rows,
            'by_category' => $byCategory,
            'totals' => array_values($totals),
            'categories' => $this->categories(),
            'accounts' => DB::table('cash_accounts')->where('is_active', true)->orderBy('sort_order')->get(['id', 'name', 'kind', 'currency'])
                ->map(fn ($a) => ['id' => (string) $a->id, 'name' => (string) $a->name, 'kind' => (string) $a->kind, 'currency' => (string) $a->currency])->all(),
            'can_manage' => Gate::allows('expense.manage'),
            'sees_salaries' => $seesSalaries,
        ]);
    }

    public function storeExpense(Request $request): JsonResponse
    {
        Gate::authorize('expense.manage');
        $academyId = $this->academyId();
        $data = $request->validate([
            'category_id' => ['nullable', 'uuid', 'required_without:payout_id'],
            'payout_id' => ['nullable', 'uuid'],
            'cash_account_id' => ['required', 'uuid'],
            'amount_minor' => ['required', 'integer', 'min:1', 'max:100000000000'],
            'spent_on' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.$this->today($academyId)],
            'payee' => ['nullable', 'string', 'max:160'],
            'description' => ['nullable', 'string', 'max:1000'],
            'attachment' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:8192'],
        ]);
        $account = DB::table('cash_accounts')->where('id', $data['cash_account_id'])->where('is_active', true)->first();
        if ($account === null) {
            throw ValidationException::withMessages(['cash_account_id' => ['Choose an open account. / اختر خزنة مفعّلة.']]);
        }
        $on = $data['spent_on'] ?? $this->today($academyId);
        $this->treasury->assertOpenDay((string) $account->id, $on);

        $categoryId = $data['category_id'] ?? null;
        $payee = $data['payee'] ?? null;
        $description = $data['description'] ?? null;
        if (isset($data['payout_id'])) {
            // A teacher's salary paid out: tied to their statement, never more than is left on it.
            Gate::authorize('payout.read');
            $payout = DB::table('payouts as p')->join('teachers as t', 't.id', '=', 'p.teacher_id')
                ->where('p.id', $data['payout_id'])->first(['p.*', 't.full_name']);
            if ($payout === null || $payout->finalized_at === null) {
                throw ValidationException::withMessages(['payout_id' => ['Only a finalized pay statement can be paid out. / يُصرف كشف المرتب بعد اعتماده فقط.']]);
            }
            if ($payout->currency !== $account->currency) {
                throw ValidationException::withMessages(['cash_account_id' => ['Pay from an account in '.$payout->currency.'. / اصرف من خزنة بنفس عملة الكشف.']]);
            }
            $left = (int) $payout->total_minor - (int) DB::table('expenses')->where('payout_id', $payout->id)->whereNull('voided_at')->sum('amount_minor');
            if ((int) $data['amount_minor'] > $left) {
                throw ValidationException::withMessages(['amount_minor' => ['More than is left to pay on this statement. / أكبر من المتبقي على كشف المرتب.']]);
            }
            $categoryId = $this->treasury->categoryId($academyId, 'teacher_salaries');
            $payee ??= (string) $payout->full_name;
            $description ??= sprintf('%04d-%02d', (int) $payout->period_year, (int) $payout->period_month);
        } elseif (! DB::table('expense_categories')->where('id', $categoryId)->where('is_active', true)->exists()) {
            throw ValidationException::withMessages(['category_id' => ['Choose a category. / اختر البند.']]);
        }

        $path = null;
        if ($request->hasFile('attachment')) {
            $file = $request->file('attachment');
            $path = $file?->storeAs("expense-attachments/{$academyId}", Str::uuid().'.'.strtolower((string) ($file->extension() ?: 'jpg')), 'local');
        }

        $id = (string) Str::uuid();
        $number = DB::transaction(function () use ($id, $academyId, $categoryId, $data, $account, $on, $payee, $description, $path) {
            $number = $this->treasury->nextNumber($academyId, 'expense', 'E');
            DB::table('expenses')->insert([
                'id' => $id, 'academy_id' => $academyId, 'number' => $number, 'spent_on' => $on, 'category_id' => $categoryId,
                'amount_minor' => (int) $data['amount_minor'], 'currency' => $account->currency, 'cash_account_id' => $account->id,
                'payee' => $payee !== null ? trim((string) $payee) : null, 'description' => $description !== null ? trim((string) $description) : null,
                'attachment_path' => is_string($path) && $path !== '' ? $path : null, 'payout_id' => $data['payout_id'] ?? null,
                'created_by' => app(AuthContext::class)->userId,
            ]);

            return $number;
        });
        $this->audit('expense.recorded', 'expense', $id, ['number' => $number, 'amount_minor' => (int) $data['amount_minor'], 'account' => $account->name, 'payout_id' => $data['payout_id'] ?? null]);

        return response()->json(['id' => $id, 'number' => $number], 201);
    }

    public function voidExpense(Request $request, string $id): JsonResponse
    {
        Gate::authorize('expense.manage');
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);
        $e = DB::table('expenses')->where('id', $id)->whereNull('voided_at')->first();
        if ($e === null) {
            abort(404, 'Expense not found.');
        }
        $this->treasury->assertOpenDay((string) $e->cash_account_id, (string) $e->spent_on);
        DB::table('expenses')->where('id', $id)->update(['voided_at' => now(), 'voided_by' => app(AuthContext::class)->userId, 'void_reason' => trim((string) $data['reason'])]);
        $this->audit('expense.voided', 'expense', $id, ['number' => $e->number, 'reason' => $data['reason']]);

        return response()->json(['ok' => true]);
    }

    public function attachment(string $id): StreamedResponse
    {
        Gate::authorize('invoice.read');
        $path = DB::table('expenses')->where('id', $id)->value('attachment_path');
        if (! is_string($path) || $path === '' || ! Storage::disk('local')->exists($path)) {
            abort(404, 'No attachment.');
        }

        return Storage::disk('local')->response($path, null, ['Cache-Control' => 'private, no-store']);
    }

    /** Finalized teacher statements with what is still to be paid out of the treasury. */
    public function salaries(): JsonResponse
    {
        Gate::authorize('payout.read');
        $paid = DB::table('expenses')->whereNotNull('payout_id')->whereNull('voided_at')->groupBy('payout_id')
            ->get(['payout_id', DB::raw('sum(amount_minor) as paid')])->keyBy(fn ($r) => (string) $r->payout_id);

        $rows = DB::table('payouts as p')->join('teachers as t', 't.id', '=', 'p.teacher_id')
            ->whereNotNull('p.finalized_at')->where('p.total_minor', '>', 0)
            ->orderByDesc('p.period_year')->orderByDesc('p.period_month')->orderBy('t.full_name')->limit(300)
            ->get(['p.id', 'p.period_year', 'p.period_month', 'p.total_minor', 'p.currency', 't.full_name'])
            ->map(function ($p) use ($paid) {
                $already = (int) ($paid[(string) $p->id]->paid ?? 0);

                return [
                    'payout_id' => (string) $p->id,
                    'teacher_name' => (string) $p->full_name,
                    'period' => sprintf('%04d-%02d', (int) $p->period_year, (int) $p->period_month),
                    'total_minor' => (int) $p->total_minor,
                    'paid_minor' => $already,
                    'remaining_minor' => max(0, (int) $p->total_minor - $already),
                    'currency' => (string) $p->currency,
                ];
            })->values()->all();

        return response()->json(['salaries' => $rows]);
    }

    public function storeCategory(Request $request): JsonResponse
    {
        Gate::authorize('expense.manage');
        $academyId = $this->academyId();
        $this->treasury->ensureCategories($academyId);
        $data = $request->validate(['name' => ['required', 'string', 'max:80']]);
        $id = (string) DB::table('expense_categories')->insertGetId([
            'academy_id' => $academyId, 'name' => trim((string) $data['name']),
            'sort_order' => (int) DB::table('expense_categories')->count(),
        ]);

        return response()->json(['id' => $id], 201);
    }

    public function updateCategory(Request $request, string $id): JsonResponse
    {
        Gate::authorize('expense.manage');
        $data = $request->validate(['name' => ['sometimes', 'string', 'max:80'], 'is_active' => ['sometimes', 'boolean']]);
        $cat = DB::table('expense_categories')->where('id', $id)->first();
        if ($cat === null) {
            abort(404, 'Category not found.');
        }
        if (($data['is_active'] ?? true) === false && $cat->key === 'teacher_salaries') {
            throw ValidationException::withMessages(['is_active' => ['Teacher salaries is where paid statements go; it stays. / بند رواتب المعلمين أساسي ولا يمكن إيقافه.']]);
        }
        DB::table('expense_categories')->where('id', $id)->update(array_filter([
            'name' => isset($data['name']) ? trim((string) $data['name']) : null,
            'is_active' => $data['is_active'] ?? null,
        ], fn ($v) => $v !== null));

        return response()->json(['ok' => true]);
    }

    // ── Income vs expenses ──────────────────────────────────────────────────

    public function incomeExpenses(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        $data = $request->validate(['year' => ['sometimes', 'nullable', 'integer', 'min:2020', 'max:2100']]);
        $year = (int) ($data['year'] ?? substr($this->today($academyId), 0, 4));
        $seesSalaries = Gate::allows('payout.read');

        $months = [];
        for ($m = 1; $m <= 12; $m++) {
            $from = sprintf('%04d-%02d-01', $year, $m);
            $to = Carbon::parse($from)->endOfMonth()->format('Y-m-d');
            $months[] = ['month' => sprintf('%04d-%02d', $year, $m)] + $this->inOut($from, $to, $seesSalaries);
        }

        $categories = [];
        foreach (DB::table('expenses as e')->join('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->whereNull('e.voided_at')->whereBetween('e.spent_on', ["{$year}-01-01", "{$year}-12-31"])
            ->when(! $seesSalaries, fn ($q) => $q->where(fn ($w) => $w->whereNull('c.key')->orWhereNotIn('c.key', ['teacher_salaries', 'staff_salaries'])))
            ->groupBy('c.id', 'c.name', 'e.currency')
            ->get(['c.name', 'e.currency', DB::raw('sum(e.amount_minor) as amount')]) as $r) {
            $categories[] = ['name' => (string) $r->name, 'currency' => (string) $r->currency, 'amount_minor' => (int) $r->amount];
        }
        usort($categories, fn ($a, $b) => $b['amount_minor'] <=> $a['amount_minor']);

        return response()->json(['year' => $year, 'months' => $months, 'categories' => $categories, 'sees_salaries' => $seesSalaries]);
    }

    // ── internals ───────────────────────────────────────────────────────────

    /**
     * Money in (receipts) and money out (expenses) between two days, per currency.
     *
     * @return array{currencies: list<array{currency: string, in_minor: int, out_minor: int, net_minor: int}>}
     */
    private function inOut(string $from, string $to, bool $seesSalaries = true): array
    {
        $in = DB::table('receipts')->whereNull('voided_at')->whereBetween('received_on', [$from, $to])
            ->groupBy('currency')->get(['currency', DB::raw('sum(amount_minor) as amount')])->pluck('amount', 'currency');
        $out = DB::table('expenses as e')->join('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->whereNull('e.voided_at')->whereBetween('e.spent_on', [$from, $to])
            ->when(! $seesSalaries, fn ($q) => $q->where(fn ($w) => $w->whereNull('c.key')->orWhereNotIn('c.key', ['teacher_salaries', 'staff_salaries'])))
            ->groupBy('e.currency')->get(['e.currency', DB::raw('sum(e.amount_minor) as amount')])->pluck('amount', 'currency');
        $rows = [];
        foreach (collect($in->keys())->merge($out->keys())->unique()->sort() as $c) {
            $i = (int) ($in[$c] ?? 0);
            $o = (int) ($out[$c] ?? 0);
            $rows[] = ['currency' => (string) $c, 'in_minor' => $i, 'out_minor' => $o, 'net_minor' => $i - $o];
        }

        return ['currencies' => $rows];
    }

    private function mapMethod(string $academyId, string $method, string $currency, ?string $accountId): void
    {
        if ($accountId === null) {
            DB::table('cash_account_methods')->where('academy_id', $academyId)->where('method', $method)->where('currency', $currency)->delete();

            return;
        }
        $account = DB::table('cash_accounts')->where('id', $accountId)->where('is_active', true)->first();
        if ($account === null || $account->currency !== $currency) {
            throw ValidationException::withMessages(['cash_account_id' => ['Choose an open account in '.$currency.'. / اختر خزنة مفعّلة بنفس العملة.']]);
        }
        DB::table('cash_account_methods')->updateOrInsert(['academy_id' => $academyId, 'method' => $method, 'currency' => $currency], ['cash_account_id' => $accountId]);
    }

    /** @return list<array{id: string, key: ?string, name: string, is_active: bool}> */
    private function categories(): array
    {
        $seesSalaries = Gate::allows('payout.read');

        return DB::table('expense_categories')->orderBy('sort_order')->orderBy('created_at')->get(['id', 'key', 'name', 'is_active'])
            ->filter(fn ($c) => $seesSalaries || ! in_array($c->key, ['teacher_salaries', 'staff_salaries'], true))
            ->map(fn ($c) => ['id' => (string) $c->id, 'key' => $c->key, 'name' => (string) $c->name, 'is_active' => (bool) $c->is_active])->values()->all();
    }

    /** @param  array<string, mixed>|null  $after */
    private function audit(string $action, string $type, ?string $id, ?array $after = null): void
    {
        $ctx = app(AuthContext::class);
        Audit::log($action, $type, $id, $this->academyId(), $ctx->userId, $ctx->role, after: $after);
    }

    private function today(string $academyId): string
    {
        return Carbon::now((string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC'))->format('Y-m-d');
    }

    private function academyId(): string
    {
        return (string) app(AuthContext::class)->academyId;
    }
}
