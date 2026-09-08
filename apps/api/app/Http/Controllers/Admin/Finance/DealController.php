<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Finance;

use App\Http\Controllers\Controller;
use App\Services\FinanceLedger;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DataTable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Super Admin → Finance → Deals: what a client agreed to pay, and the money against it.
 *
 * A deal is either a ONE_TIME sale — a course site, a copy of the management system, a custom
 * job — optionally split into installments, or a SUBSCRIPTION with a billing cycle. The money
 * rules (waterfall coverage, rolling cycles, auto-completing a paid-off sale) live in
 * FinanceLedger; this controller validates, writes, audits and hands back the deal page payload.
 *
 * "Record income" is the same verb: a deal created with an inline `payment` is a sale that was
 * paid on the spot, and the ledger marks it COMPLETED in the same transaction.
 */
final class DealController extends Controller
{
    public function __construct(private readonly FinanceLedger $ledger) {}

    /** GET /api/admin/finance/deals */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $result = DataTable::paginate($this->ledger->dealsQuery(), $request, [
            'searchable' => ['title', 'client_name', 'notes'],
            'sortable' => [
                'title' => 'title',
                'client_name' => 'client_name',
                'started_on' => 'started_on',
                'next_due_on' => 'next_due_on',
                'amount_minor' => 'amount_minor',
                'paid_minor' => 'paid_minor',
                'outstanding_minor' => 'outstanding_minor',
                'status' => 'status',
                'created_at' => 'created_at',
                'id' => 'id',
            ],
            'filters' => [
                'status' => fn (Builder $q, $value) => $q->where('status', strtoupper((string) $value)),
                'kind' => fn (Builder $q, $value) => $q->where('kind', strtoupper((string) $value)),
                'service' => fn (Builder $q, $value) => $q->where('service', strtoupper((string) $value)),
                'currency' => fn (Builder $q, $value) => $q->where('currency', strtoupper((string) $value)),
                'client_id' => fn (Builder $q, $value) => $q->where('client_id', (string) $value),
                // "Show me what is late": active deals with money owed past its date.
                'overdue' => fn (Builder $q, $value) => (string) $value === '1'
                    ? $q->where('status', 'ACTIVE')->where('overdue_minor', '>', 0)
                    : $q,
            ],
            'defaultSort' => '-created_at,-id',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $row): object => $this->ledger->normalizeDeal($row));
        $result['counts'] = $this->counts();

        return response()->json($result);
    }

    /** GET /api/admin/finance/deals/{id} — the deal page payload. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        return response()->json($this->payload($id));
    }

    /**
     * POST /api/admin/finance/deals — a new deal, with either an existing `client_id` or an inline
     * new `client`, an optional installment plan (one-time sales) and an optional first payment.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $data = $request->validate([
            'client_id' => ['required_without:client', 'nullable', 'uuid'],
            'client' => ['required_without:client_id', 'nullable', 'array'],
            'client.name' => ['required_with:client', 'string', 'max:160'],
            'client.phone' => ['nullable', 'string', 'max:40'],
            'client.email' => ['nullable', 'email', 'max:190'],
            'title' => ['required', 'string', 'max:200'],
            'service' => ['required', Rule::in(FinanceLedger::SERVICES)],
            'kind' => ['required', Rule::in(FinanceLedger::KINDS)],
            'billing_interval' => ['nullable', Rule::in(FinanceLedger::INTERVALS), 'required_if:kind,SUBSCRIPTION'],
            'amount_minor' => ['nullable', 'integer', 'min:0', 'max:999999999999'],
            'currency' => ['required', Rule::in(FinanceLedger::CURRENCIES)],
            'started_on' => ['required', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:4000'],
            'installments' => ['nullable', 'array', 'max:120'],
            'installments.*.due_on' => ['required', 'date_format:Y-m-d'],
            'installments.*.amount_minor' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'installments.*.note' => ['nullable', 'string', 'max:300'],
            'payment' => ['nullable', 'array'],
            'payment.paid_on' => ['required_with:payment', 'date_format:Y-m-d'],
            'payment.amount_minor' => ['required_with:payment', 'integer', 'min:1', 'max:999999999999'],
            'payment.method' => ['required_with:payment', Rule::in(FinanceLedger::METHODS)],
            'payment.reference' => ['nullable', 'string', 'max:200'],
            'payment.note' => ['nullable', 'string', 'max:1000'],
        ]);

        $installments = $data['kind'] === 'ONE_TIME' ? array_values($data['installments'] ?? []) : [];
        $amount = (int) ($data['amount_minor'] ?? 0);
        if ($installments === [] && $amount <= 0) {
            throw ValidationException::withMessages(['amount_minor' => 'Enter the amount, or an installment plan.']);
        }

        $ctx = app(AuthContext::class);

        $id = DB::transaction(function () use ($data, $installments, $amount): string {
            $clientId = $data['client_id'] ?? null;
            if ($clientId === null) {
                $clientId = $this->findOrCreateClient($data['client']);
            } elseif (! DB::table('finance_clients')->where('id', $clientId)->exists()) {
                throw ValidationException::withMessages(['client_id' => 'Unknown client.']);
            }

            $id = $this->ledger->createDeal([
                'client_id' => $clientId,
                'title' => trim($data['title']),
                'service' => $data['service'],
                'kind' => $data['kind'],
                'billing_interval' => $data['kind'] === 'SUBSCRIPTION' ? $data['billing_interval'] : null,
                'amount_minor' => $amount,
                'currency' => $data['currency'],
                'started_on' => $data['started_on'],
                'notes' => $this->blankToNull($data['notes'] ?? null),
            ], $installments);

            if (! empty($data['payment'])) {
                $this->ledger->recordPayment($id, $this->paymentColumns($data['payment']));
            }

            return $id;
        });

        Audit::log(
            action: 'finance_deal.created',
            entityType: 'finance_deal',
            entityId: $id,
            academyId: null,
            actorUserId: $ctx->userId,
            actorRole: $ctx->role,
            before: null,
            after: ['title' => $data['title'], 'kind' => $data['kind'], 'service' => $data['service'], 'currency' => $data['currency']],
        );

        return response()->json($this->payload($id), 201);
    }

    /**
     * PATCH /api/admin/finance/deals/{id} — the deal's own facts. The kind is fixed (a sale does
     * not turn into a subscription; make a new deal); a one-time sale's total follows its schedule
     * (edit that instead); the currency can change only while nothing has been received in it.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $deal = DB::table('finance_deals')->where('id', $id)->first();
        if ($deal === null) {
            abort(404, 'Deal not found.');
        }

        $data = $request->validate([
            'client_id' => ['sometimes', 'uuid'],
            'title' => ['sometimes', 'string', 'max:200'],
            'service' => ['sometimes', Rule::in(FinanceLedger::SERVICES)],
            'billing_interval' => ['sometimes', Rule::in(FinanceLedger::INTERVALS)],
            'amount_minor' => ['sometimes', 'integer', 'min:0', 'max:999999999999'],
            'currency' => ['sometimes', Rule::in(FinanceLedger::CURRENCIES)],
            'started_on' => ['sometimes', 'date_format:Y-m-d'],
            'status' => ['sometimes', Rule::in(FinanceLedger::STATUSES)],
            'notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ]);

        $patch = [];
        if (isset($data['client_id'])) {
            if (! DB::table('finance_clients')->where('id', $data['client_id'])->exists()) {
                throw ValidationException::withMessages(['client_id' => 'Unknown client.']);
            }
            $patch['client_id'] = $data['client_id'];
        }
        if (isset($data['title'])) {
            $patch['title'] = trim($data['title']);
        }
        foreach (['service', 'started_on', 'status'] as $col) {
            if (isset($data[$col])) {
                $patch[$col] = $data[$col];
            }
        }
        if (array_key_exists('notes', $data)) {
            $patch['notes'] = $this->blankToNull($data['notes']);
        }
        if ($deal->kind === 'SUBSCRIPTION') {
            if (isset($data['billing_interval'])) {
                $patch['billing_interval'] = $data['billing_interval'];
            }
            if (isset($data['amount_minor'])) {
                $patch['amount_minor'] = (int) $data['amount_minor'];
            }
        }
        if (isset($data['currency']) && $data['currency'] !== $deal->currency) {
            if (DB::table('finance_payments')->where('deal_id', $id)->exists()) {
                throw ValidationException::withMessages(['currency' => 'Money has been received on this deal; its currency is fixed.']);
            }
            $patch['currency'] = $data['currency'];
        }

        if ($patch !== []) {
            DB::table('finance_deals')->where('id', $id)->update($patch + ['updated_at' => DB::raw('now()')]);
            // Reactivating a subscription must leave it with an open cycle.
            $this->ledger->settle($id);
        }

        return response()->json($this->payload($id));
    }

    /** DELETE /api/admin/finance/deals/{id} — the deal with its schedule and payments. */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $deal = DB::table('finance_deals')->where('id', $id)->first();
        if ($deal === null) {
            abort(404, 'Deal not found.');
        }

        $paid = (int) DB::table('finance_payments')->where('deal_id', $id)->sum('amount_minor');
        DB::table('finance_deals')->where('id', $id)->delete();

        $ctx = app(AuthContext::class);
        Audit::log(
            action: 'finance_deal.deleted',
            entityType: 'finance_deal',
            entityId: $id,
            academyId: null,
            actorUserId: $ctx->userId,
            actorRole: $ctx->role,
            before: ['title' => $deal->title, 'kind' => $deal->kind, 'currency' => $deal->currency, 'paid_minor' => $paid],
            after: null,
        );

        return response()->json(['ok' => true]);
    }

    /** PUT /api/admin/finance/deals/{id}/schedule — replace the installment plan. */
    public function replaceSchedule(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        if (! DB::table('finance_deals')->where('id', $id)->exists()) {
            abort(404, 'Deal not found.');
        }

        $data = $request->validate([
            'installments' => ['required', 'array', 'min:1', 'max:120'],
            'installments.*.due_on' => ['required', 'date_format:Y-m-d'],
            'installments.*.amount_minor' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'installments.*.note' => ['nullable', 'string', 'max:300'],
        ]);

        $this->ledger->replaceSchedule($id, array_values($data['installments']));

        return response()->json($this->payload($id));
    }

    /** POST /api/admin/finance/deals/{id}/payments — money received against this deal. */
    public function storePayment(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        if (! DB::table('finance_deals')->where('id', $id)->exists()) {
            abort(404, 'Deal not found.');
        }

        $data = $request->validate([
            'paid_on' => ['required', 'date_format:Y-m-d'],
            'amount_minor' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'method' => ['required', Rule::in(FinanceLedger::METHODS)],
            'reference' => ['nullable', 'string', 'max:200'],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $paymentId = $this->ledger->recordPayment($id, $this->paymentColumns($data));

        $ctx = app(AuthContext::class);
        Audit::log(
            action: 'finance_payment.recorded',
            entityType: 'finance_payment',
            entityId: $paymentId,
            academyId: null,
            actorUserId: $ctx->userId,
            actorRole: $ctx->role,
            before: null,
            after: ['deal_id' => $id, 'amount_minor' => (int) $data['amount_minor'], 'paid_on' => $data['paid_on'], 'method' => $data['method']],
        );

        return response()->json($this->payload($id), 201);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** @return array<string,mixed> */
    private function payload(string $id): array
    {
        $deal = $this->ledger->deal($id);
        if ($deal === null) {
            abort(404, 'Deal not found.');
        }

        $client = $this->ledger->clientsQuery()->where('id', $deal->client_id)->first();

        return [
            'deal' => $deal,
            'client' => $client === null ? null : $this->ledger->normalizeClient($client),
            'schedule' => $this->ledger->schedule($id),
            'payments' => $this->ledger->payments($id)->all(),
        ];
    }

    /** @return array<string,int> */
    private function counts(): array
    {
        $rows = DB::table('finance_deals')->selectRaw('status, count(*) as n')->groupBy('status')->get();

        $counts = array_fill_keys(FinanceLedger::STATUSES, 0);
        $total = 0;
        foreach ($rows as $row) {
            $counts[(string) $row->status] = (int) $row->n;
            $total += (int) $row->n;
        }
        $counts['total'] = $total;
        $counts['overdue'] = (int) $this->ledger->dealsQuery()->where('status', 'ACTIVE')->where('overdue_minor', '>', 0)->count();

        return $counts;
    }

    /** @param array<string,mixed> $client */
    private function findOrCreateClient(array $client): string
    {
        $name = trim((string) $client['name']);
        if ($name === '') {
            throw ValidationException::withMessages(['client.name' => 'A client name is required.']);
        }

        // Typing an existing client's name in the "new client" box means that client, not a twin.
        $existing = DB::table('finance_clients')->whereRaw('lower(name) = lower(?)', [$name])->value('id');
        if ($existing !== null) {
            return (string) $existing;
        }

        return (string) DB::table('finance_clients')->insertGetId([
            'id' => DB::raw('uuid_generate_v7()'),
            'name' => $name,
            'phone' => $this->blankToNull($client['phone'] ?? null),
            'email' => $this->blankToNull($client['email'] ?? null),
        ], 'id');
    }

    /**
     * @param  array<string,mixed>  $payment
     * @return array<string,mixed>
     */
    private function paymentColumns(array $payment): array
    {
        return [
            'paid_on' => $payment['paid_on'],
            'amount_minor' => (int) $payment['amount_minor'],
            'method' => $payment['method'],
            'reference' => $this->blankToNull($payment['reference'] ?? null),
            'note' => $this->blankToNull($payment['note'] ?? null),
        ];
    }

    private function blankToNull(mixed $value): ?string
    {
        $value = trim((string) ($value ?? ''));

        return $value === '' ? null : $value;
    }
}
