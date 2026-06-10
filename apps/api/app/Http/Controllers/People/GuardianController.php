<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\Phone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Guardians — the billing anchor (R-STU-1/2). A guardian owns 1..N students; their currency
 * defaults to the academy default but may differ (AC-4.6). Two-layer authorization: a
 * capability Gate first, RLS as the database backstop. Deactivate-not-delete preserves
 * history; a guardian with active children cannot be deactivated (AC-4.12 / TC-4.6).
 */
final class GuardianController extends Controller
{
    use InteractsWithPeople;

    /** GET /api/guardians — server-driven DataTable (search/filter/sort/paginate). */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('guardian.read');

        $query = DB::table('guardians')->select([
            'id', 'full_name', 'whatsapp_phone', 'country', 'currency', 'notes',
            'deleted_at', 'created_at',
        ]);

        // Active-only by default; filter[status]=inactive|all reveals soft-deleted rows (TC-4.5).
        $this->applyActiveScope($query, $request);

        $result = DataTable::paginate($query, $request, [
            'searchable' => ['full_name', 'whatsapp_phone'],
            'sortable' => ['name' => 'full_name', 'created_at' => 'created_at'],
            'filters' => [
                'currency' => fn ($q, $value) => $q->where('currency', strtoupper((string) $value)),
            ],
            'defaultSort' => 'name',
        ]);

        return response()->json($result);
    }

    /** POST /api/guardians — create. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('guardian.create');

        $academyId = $this->currentAcademyId();
        $data = $this->validatePayload($request, creating: true);

        $id = (string) Str::uuid();
        $row = [
            'id' => $id,
            'academy_id' => $academyId,
            'full_name' => $data['full_name'],
            'whatsapp_phone' => Phone::normalize($data['whatsapp_phone'], 'whatsapp_phone'),
            'country' => $data['country'] ?? null,
            'currency' => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
            'notes' => $data['notes'] ?? null,
        ];

        DB::table('guardians')->insert($row);
        Audit::log('guardian.create', 'guardian', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name' => $row['full_name'],
            'whatsapp_phone' => $row['whatsapp_phone'],
            'currency' => $row['currency'],
        ]);

        return response()->json(['guardianId' => $id], 201);
    }

    /** GET /api/guardians/{id} — detail with the guardian's children. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('guardian.read');

        $guardian = DB::table('guardians')->where('id', $id)->first();
        if ($guardian === null) {
            abort(404, 'Guardian not found.');
        }

        $children = DB::table('students')
            ->where('guardian_id', $id)
            ->orderBy('full_name')
            ->get(['id', 'full_name', 'whatsapp_phone', 'status', 'is_self_guardian', 'deleted_at']);

        return response()->json(['guardian' => $guardian, 'children' => $children]);
    }

    /** PATCH /api/guardians/{id} — edit; before/after audit of exactly the changed fields. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('guardian.update');

        $existing = DB::table('guardians')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Guardian not found.');
        }

        $data = $this->validatePayload($request, creating: false);
        if (array_key_exists('whatsapp_phone', $data)) {
            $data['whatsapp_phone'] = Phone::normalize($data['whatsapp_phone'], 'whatsapp_phone');
        }
        if (array_key_exists('currency', $data) && $data['currency'] !== null) {
            $data['currency'] = strtoupper($data['currency']);
        }

        [$before, $after] = $this->diff($existing, $data, ['full_name', 'whatsapp_phone', 'country', 'currency', 'notes']);
        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('guardians')->where('id', $id)->update($after + ['updated_at' => now()]);
        Audit::log('guardian.update', 'guardian', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['ok' => true, 'changed' => array_keys($after)]);
    }

    /** POST /api/guardians/{id}/deactivate — soft-delete; blocked while active children exist. */
    public function deactivate(string $id): JsonResponse
    {
        Gate::authorize('guardian.update');

        $guardian = DB::table('guardians')->where('id', $id)->whereNull('deleted_at')->first();
        if ($guardian === null) {
            abort(404, 'Guardian not found.');
        }

        $activeChildren = DB::table('students')->where('guardian_id', $id)->whereNull('deleted_at')->count();
        if ($activeChildren > 0) {
            abort(422, 'Deactivate this guardian\'s active students first.');
        }

        DB::table('guardians')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        Audit::log('guardian.deactivate', 'guardian', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: ['deleted_at' => now()->toIso8601String()]);

        return response()->json(['ok' => true]);
    }

    /**
     * Compute the before/after of changed columns only (mirrors AcademyController::update).
     *
     * @param  array<string,mixed>  $data
     * @param  list<string>  $cols
     * @return array{0: array<string,mixed>, 1: array<string,mixed>}
     */
    private function diff(object $existing, array $data, array $cols): array
    {
        $before = [];
        $after = [];
        foreach ($cols as $col) {
            if (array_key_exists($col, $data) && (string) $data[$col] !== (string) $existing->{$col}) {
                $before[$col] = $existing->{$col};
                $after[$col] = $data[$col];
            }
        }

        return [$before, $after];
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'full_name' => [$req, 'string', 'max:255'],
            'whatsapp_phone' => [$req, 'string', 'max:32'],
            'country' => ['nullable', 'string', 'max:2'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }
}
