<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Finance;

use App\Http\Controllers\Controller;
use App\Services\FinanceLedger;
use App\Services\PlatformAccounts;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Super Admin → Accounts: the people and companies that pay the owner, and how they pay.
 *
 * An account is one paying client. A PLATFORM client (an academy on our servers) has exactly one,
 * linked by `linked_academy_id` (exposed as `academy_id`) and reached from its client page; a client off our servers (bought the
 * whole system, a course site, a custom job) exists only here. The agreement — monthly, every 3
 * or 6 months, yearly, one payment + yearly support, outright purchase — is set through
 * PlatformAccounts; the money arithmetic is FinanceLedger's.
 */
final class ClientController extends Controller
{
    public function __construct(
        private readonly FinanceLedger $ledger,
        private readonly PlatformAccounts $accounts,
    ) {}

    /** GET /api/admin/finance/clients — the contracts list: one row per account. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $result = DataTable::paginate($this->ledger->clientsQuery(), $request, [
            'searchable' => ['name', 'phone', 'email', 'academy_name'],
            'sortable' => [
                'name' => 'name',
                'created_at' => 'created_at',
                'next_due_on' => 'next_due_on',
                'rec_amount_minor' => 'rec_amount_minor',
                'deals_count' => 'deals_count',
                'active_deals' => 'active_deals',
                'last_paid_on' => 'last_paid_on',
                'id' => 'id',
            ],
            'filters' => [
                'active' => fn ($q, $value) => (string) $value === '1' ? $q->where('active_deals', '>', 0) : $q->where('active_deals', 0),
                'plan' => fn ($q, $value) => $q->where('plan', strtoupper((string) $value)),
                // On our servers (a platform client) or off them.
                'hosted' => fn ($q, $value) => (string) $value === '1' ? $q->whereNotNull('academy_id') : $q->whereNull('academy_id'),
                'overdue' => fn ($q, $value) => (string) $value === '1' ? $q->where('has_overdue', true) : $q,
            ],
            'defaultSort' => 'name,id',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $row): object => $this->ledger->normalizeClient($row));
        $result['counts'] = [
            'all' => DB::table('finance_clients')->count(),
            'hosted' => DB::table('finance_clients')->whereNotNull('linked_academy_id')->count(),
            'external' => DB::table('finance_clients')->whereNull('linked_academy_id')->count(),
        ];

        return response()->json($result);
    }

    /** GET /api/admin/finance/clients/{id} — one account's page. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        return response()->json($this->payload($id));
    }

    /**
     * PUT /api/admin/finance/clients/{id}/agreement — set (or change) how this client pays. A
     * change ends the running recurring line on the day the new one starts; what was already due
     * stays owed. `paid_now` records money received on the spot (a down payment, a first cycle).
     */
    public function agreement(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        if (! DB::table('finance_clients')->where('id', $id)->exists()) {
            abort(404, 'Client not found.');
        }

        $this->applyAgreement($id, $this->agreementInput($request));

        return response()->json($this->payload($id));
    }

    /**
     * POST /api/admin/finance/clients/{id}/payments — money received from this client (not from
     * one deal): it pays its oldest dues first, across every active line in that currency.
     */
    public function receive(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        if (! DB::table('finance_clients')->where('id', $id)->exists()) {
            abort(404, 'Client not found.');
        }

        $data = $request->validate([
            'currency' => ['required', Rule::in(FinanceLedger::CURRENCIES)],
            'paid_on' => ['required', 'date_format:Y-m-d'],
            'amount_minor' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'method' => ['required', Rule::in(FinanceLedger::METHODS)],
            'reference' => ['nullable', 'string', 'max:200'],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $this->ledger->receiveFromClient($id, $data['currency'], [
            'paid_on' => $data['paid_on'],
            'amount_minor' => (int) $data['amount_minor'],
            'method' => $data['method'],
            'reference' => $this->blank($data['reference'] ?? null),
            'note' => $this->blank($data['note'] ?? null),
        ]);
        $this->audit('finance_payment.received', $id, ['amount_minor' => (int) $data['amount_minor'], 'currency' => $data['currency']]);

        return response()->json($this->payload($id), 201);
    }

    /** GET /api/admin/clients/{academyId}/account — a platform client's account, or null before it has one. */
    public function forAcademy(string $academyId): JsonResponse
    {
        Gate::authorize('platform.manage');

        $id = $this->accounts->accountIdFor($academyId);

        return response()->json($id === null ? ['account' => null] : $this->payload($id));
    }

    /** PUT /api/admin/clients/{academyId}/agreement — set a platform client's agreement (opens its account). */
    public function agreementForAcademy(Request $request, string $academyId): JsonResponse
    {
        Gate::authorize('platform.manage');
        if (DB::table('academies')->where('id', $academyId)->doesntExist()) {
            abort(404, 'Client not found.');
        }

        $input = $this->agreementInput($request);
        $id = DB::transaction(function () use ($academyId, $input): string {
            $id = $this->accounts->ensureForAcademy($academyId);
            $this->applyAgreement($id, $input);

            return $id;
        });

        return response()->json($this->payload($id));
    }

    /** GET /api/admin/finance/clients/all — id + name of every client, for the deal form's picker. */
    public function all(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $rows = DB::table('finance_clients')->orderBy('name')->get(['id', 'name', 'phone']);

        return response()->json(['clients' => $rows]);
    }

    /**
     * POST /api/admin/finance/clients — a client off our servers (a platform client gets its
     * account from its own page). An optional `agreement` sets how it pays in the same step.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $data = $this->validated($request, true);
        $this->assertNameFree($data['name']);
        $agreement = $request->has('agreement') ? $this->agreementInput($request, 'agreement.') : null;

        $id = DB::transaction(function () use ($data, $agreement): string {
            $id = (string) DB::table('finance_clients')->insertGetId(
                ['id' => DB::raw('uuid_generate_v7()')] + $data,
                'id',
            );
            $this->accounts->ensurePayToken($id);
            if ($agreement !== null) {
                $this->applyAgreement($id, $agreement);
            }

            return $id;
        });

        return response()->json(['client' => $this->one($id)] + $this->payload($id), 201);
    }

    /** PATCH /api/admin/finance/clients/{id} */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        if (! DB::table('finance_clients')->where('id', $id)->exists()) {
            abort(404, 'Client not found.');
        }

        $data = $this->validated($request, false);
        if (isset($data['name'])) {
            $this->assertNameFree($data['name'], $id);
        }

        if ($data !== []) {
            DB::table('finance_clients')->where('id', $id)->update($data + ['updated_at' => DB::raw('now()')]);
        }

        return response()->json(['client' => $this->one($id)]);
    }

    /**
     * DELETE /api/admin/finance/clients/{id} — only a client with no deals. A client with history
     * is a row in the owner's statistics; removing it would silently change last year's totals.
     */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        if (! DB::table('finance_clients')->where('id', $id)->exists()) {
            abort(404, 'Client not found.');
        }
        if (DB::table('finance_deals')->where('client_id', $id)->exists()) {
            abort(409, 'This client has deals. Delete the deals first, or keep the client.');
        }

        DB::table('finance_clients')->where('id', $id)->delete();

        return response()->json(['ok' => true]);
    }

    /** @return array<string,mixed> */
    private function validated(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';
        $data = $request->validate([
            'name' => [$req, 'string', 'max:160'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'email' => ['sometimes', 'nullable', 'email', 'max:190'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ]);

        foreach (['name', 'phone', 'email', 'notes'] as $col) {
            if (array_key_exists($col, $data)) {
                $value = trim((string) ($data[$col] ?? ''));
                $data[$col] = $value === '' ? null : $value;
            }
        }
        if ($creating && ($data['name'] ?? null) === null) {
            throw ValidationException::withMessages(['name' => 'A name is required.']);
        }

        return $data;
    }

    /**
     * The agreement fields (also nested under `agreement.` on store).
     *
     * @return array<string,mixed>
     */
    private function agreementInput(Request $request, string $prefix = ''): array
    {
        $p = $prefix;
        $data = $request->validate([
            $p.'plan' => ['required', Rule::in(PlatformAccounts::PLANS)],
            $p.'currency' => ['required', Rule::in(FinanceLedger::CURRENCIES)],
            $p.'service' => ['nullable', Rule::in(FinanceLedger::SERVICES)],
            $p.'notes' => ['nullable', 'string', 'max:4000'],
            $p.'activate' => ['sometimes', 'boolean'],
            $p.'recurring' => ['nullable', 'array'],
            $p.'recurring.amount_minor' => ['required_with:'.$p.'recurring', 'integer', 'min:1', 'max:999999999999'],
            $p.'recurring.list_amount_minor' => ['nullable', 'integer', 'min:1', 'max:999999999999'],
            $p.'recurring.first_due_on' => ['required_with:'.$p.'recurring', 'date_format:Y-m-d'],
            $p.'recurring.title' => ['nullable', 'string', 'max:200'],
            $p.'one_time' => ['nullable', 'array'],
            $p.'one_time.title' => ['nullable', 'string', 'max:200'],
            $p.'one_time.installments' => ['required_with:'.$p.'one_time', 'array', 'min:1', 'max:120'],
            $p.'one_time.installments.*.due_on' => ['required', 'date_format:Y-m-d'],
            $p.'one_time.installments.*.amount_minor' => ['required', 'integer', 'min:1', 'max:999999999999'],
            $p.'one_time.installments.*.note' => ['nullable', 'string', 'max:300'],
            $p.'paid_now' => ['nullable', 'array'],
            $p.'paid_now.amount_minor' => ['required_with:'.$p.'paid_now', 'integer', 'min:1', 'max:999999999999'],
            $p.'paid_now.paid_on' => ['required_with:'.$p.'paid_now', 'date_format:Y-m-d'],
            $p.'paid_now.method' => ['required_with:'.$p.'paid_now', Rule::in(FinanceLedger::METHODS)],
            $p.'paid_now.reference' => ['nullable', 'string', 'max:200'],
        ]);

        return $prefix === '' ? $data : (array) ($data['agreement'] ?? []);
    }

    /** @param array<string,mixed> $input */
    private function applyAgreement(string $id, array $input): void
    {
        DB::transaction(function () use ($id, $input): void {
            $this->accounts->setAgreement($id, $input);
            if (! empty($input['paid_now'])) {
                $this->ledger->receiveFromClient($id, strtoupper((string) $input['currency']), [
                    'paid_on' => $input['paid_now']['paid_on'],
                    'amount_minor' => (int) $input['paid_now']['amount_minor'],
                    'method' => $input['paid_now']['method'],
                    'reference' => $this->blank($input['paid_now']['reference'] ?? null),
                ]);
            }
        });
        $this->audit('finance_agreement.set', $id, [
            'plan' => $input['plan'],
            'currency' => $input['currency'],
            'recurring_minor' => $input['recurring']['amount_minor'] ?? null,
            'one_time_minor' => isset($input['one_time']['installments'])
                ? array_sum(array_map(fn (array $i): int => (int) $i['amount_minor'], $input['one_time']['installments']))
                : null,
        ]);
    }

    /** @return array<string,mixed> */
    private function payload(string $id): array
    {
        $payload = $this->ledger->accountPayload($id);
        if ($payload === null) {
            abort(404, 'Client not found.');
        }
        $token = $payload['account']->pay_token ?? $this->accounts->ensurePayToken($id);
        $payload['pay_url'] = $this->accounts->payUrl((string) $token);

        return $payload;
    }

    /** @param array<string,mixed> $after */
    private function audit(string $action, string $clientId, array $after): void
    {
        $ctx = app(AuthContext::class);
        Audit::log(
            action: $action,
            entityType: 'finance_client',
            entityId: $clientId,
            academyId: null,
            actorUserId: $ctx->userId,
            actorRole: $ctx->role,
            before: null,
            after: $after,
        );
    }

    private function blank(mixed $value): ?string
    {
        $value = trim((string) ($value ?? ''));

        return $value === '' ? null : $value;
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $taken = DB::table('finance_clients')
            ->whereRaw('lower(name) = lower(?)', [$name])
            ->when($exceptId !== null, fn ($q) => $q->where('id', '<>', $exceptId))
            ->exists();

        if ($taken) {
            throw ValidationException::withMessages(['name' => 'A client with this name already exists.']);
        }
    }

    private function one(string $id): object
    {
        $row = $this->ledger->clientsQuery()->where('id', $id)->first();

        return $this->ledger->normalizeClient($row);
    }
}
