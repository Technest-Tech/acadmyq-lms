<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Finance;

use App\Http\Controllers\Controller;
use App\Services\FinanceLedger;
use App\Support\DataTable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Super Admin → Finance → Clients: the people and companies that pay the owner.
 *
 * A finance client is a name in the owner's book, deliberately NOT an academy: the owner sells
 * to people who never become tenants (a custom job, hosting), and a tenant's billing lives in
 * the module engine. The two never reference each other.
 */
final class ClientController extends Controller
{
    public function __construct(private readonly FinanceLedger $ledger) {}

    /** GET /api/admin/finance/clients — the roster with per-currency received/outstanding. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $result = DataTable::paginate($this->ledger->clientsQuery(), $request, [
            'searchable' => ['name', 'phone', 'email'],
            'sortable' => [
                'name' => 'name',
                'created_at' => 'created_at',
                'deals_count' => 'deals_count',
                'active_deals' => 'active_deals',
                'last_paid_on' => 'last_paid_on',
                'id' => 'id',
            ],
            'filters' => [
                'active' => fn ($q, $value) => (string) $value === '1' ? $q->where('active_deals', '>', 0) : $q->where('active_deals', 0),
            ],
            'defaultSort' => 'name,id',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $row): object => $this->ledger->normalizeClient($row));

        return response()->json($result);
    }

    /** GET /api/admin/finance/clients/all — id + name of every client, for the deal form's picker. */
    public function all(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $rows = DB::table('finance_clients')->orderBy('name')->get(['id', 'name', 'phone']);

        return response()->json(['clients' => $rows]);
    }

    /** POST /api/admin/finance/clients */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $data = $this->validated($request, true);
        $this->assertNameFree($data['name']);

        $id = (string) DB::table('finance_clients')->insertGetId(
            ['id' => DB::raw('uuid_generate_v7()')] + $data,
            'id',
        );

        return response()->json(['client' => $this->one($id)], 201);
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
