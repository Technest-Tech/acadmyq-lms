<?php

declare(strict_types=1);

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Discount presets (بنود الخصم): the discounts an academy gives over and over, defined once — name,
 * a percentage or a fixed amount, notes. The family card's "Add discount" offers them; a discount
 * made from one copies it and keeps `preset_id`. Retired with `is_active = false`, never deleted.
 *
 *   GET   /accounting/discount-presets           (invoice.read — the desk picks from them)
 *   POST  /accounting/discount-presets           (payment_settings.manage or receipt.void)
 *   PATCH /accounting/discount-presets/{id}      (payment_settings.manage or receipt.void)
 *
 * Managing is the money desk's (owner, manager, accountant — `receipt.void` is the accountant's),
 * never a supervisor's.
 *
 * Values travel like the family discount form's: PERCENT as a whole percent (1–100), FIXED in minor
 * units; stored and answered like `payer_discounts` (PERCENT in basis points).
 */
final class DiscountPresetController extends Controller
{
    public function index(): JsonResponse
    {
        Gate::authorize('invoice.read');

        $used = DB::table('payer_discounts')->whereNotNull('preset_id')->selectRaw('preset_id, count(*) as uses')->groupBy('preset_id');
        $rows = DB::table('discount_presets as p')
            ->leftJoinSub($used, 'u', 'u.preset_id', '=', 'p.id')
            ->leftJoin('users as us', 'us.id', '=', 'p.created_by')
            ->orderByDesc('p.is_active')->orderBy('p.name')
            ->get(['p.*', DB::raw('coalesce(u.uses, 0) as uses'), 'us.full_name as created_by_name']);

        return response()->json([
            'presets' => $rows->map(fn ($p) => $this->present($p))->values()->all(),
            'can_manage' => self::canManage(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless(self::canManage(), 403);
        $data = $this->validated($request, true);
        $ctx = app(AuthContext::class);

        $id = (string) DB::table('discount_presets')->insertGetId([
            'academy_id' => (string) $ctx->academyId,
            'name' => trim((string) $data['name']),
            'kind' => $data['kind'],
            'value' => $this->stored($data['kind'], (int) $data['value']),
            'notes' => $this->clean($data['notes'] ?? null),
            'is_active' => true,
            'created_by' => $ctx->userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Audit::log('accounting.discount_preset_created', 'discount_preset', $id, (string) $ctx->academyId, $ctx->userId, $ctx->role,
            after: ['name' => trim((string) $data['name']), 'kind' => $data['kind'], 'value' => (int) $data['value']]);

        return response()->json(['preset' => $this->present($this->row($id))], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        abort_unless(self::canManage(), 403);
        $current = DB::table('discount_presets')->where('id', $id)->first();
        if ($current === null) {
            abort(404, 'Preset not found.');
        }
        $data = $this->validated($request, false);

        $kind = $data['kind'] ?? (string) $current->kind;
        $changes = ['updated_at' => now()];
        if (isset($data['name'])) {
            $changes['name'] = trim((string) $data['name']);
        }
        if (array_key_exists('value', $data) || isset($data['kind'])) {
            if (! array_key_exists('value', $data)) {
                throw ValidationException::withMessages(['value' => ['Give the value with the kind. / أدخل القيمة مع النوع.']]);
            }
            $changes['kind'] = $kind;
            $changes['value'] = $this->stored($kind, (int) $data['value']);
        }
        if (array_key_exists('notes', $data)) {
            $changes['notes'] = $this->clean($data['notes']);
        }
        if (array_key_exists('is_active', $data)) {
            $changes['is_active'] = (bool) $data['is_active'];
        }

        DB::table('discount_presets')->where('id', $id)->update($changes);
        $ctx = app(AuthContext::class);
        Audit::log('accounting.discount_preset_updated', 'discount_preset', $id, (string) $ctx->academyId, $ctx->userId, $ctx->role,
            after: array_diff_key($changes, ['updated_at' => true]),
            before: ['name' => $current->name, 'kind' => $current->kind, 'value' => (int) $current->value, 'is_active' => (bool) $current->is_active]);

        return response()->json(['preset' => $this->present($this->row($id))]);
    }

    private static function canManage(): bool
    {
        return Gate::any(['payment_settings.manage', 'receipt.void']);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, bool $creating): array
    {
        $data = $request->validate([
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'min:1', 'max:80'],
            'kind' => [$creating ? 'required' : 'sometimes', Rule::in(['PERCENT', 'FIXED'])],
            'value' => [$creating ? 'required' : 'sometimes', 'integer', 'min:1', 'max:1000000000'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        if (isset($data['name']) && trim((string) $data['name']) === '') {
            throw ValidationException::withMessages(['name' => ['Give the preset a name. / أدخل اسم البند.']]);
        }

        return $data;
    }

    private function stored(string $kind, int $value): int
    {
        if ($kind === 'PERCENT' && $value > 100) {
            throw ValidationException::withMessages(['value' => ['A percentage is 1–100. / النسبة من 1 إلى 100.']]);
        }

        return $kind === 'PERCENT' ? $value * 100 : $value;
    }

    private function row(string $id): object
    {
        return DB::table('discount_presets as p')
            ->leftJoin('users as us', 'us.id', '=', 'p.created_by')
            ->where('p.id', $id)
            ->first(['p.*', DB::raw('(select count(*) from payer_discounts d where d.preset_id = p.id) as uses'), 'us.full_name as created_by_name']);
    }

    /** @return array<string, mixed> */
    private function present(object $p): array
    {
        return [
            'id' => (string) $p->id,
            'name' => (string) $p->name,
            'kind' => (string) $p->kind,
            'value' => (int) $p->value,
            'notes' => $p->notes,
            'is_active' => (bool) $p->is_active,
            'uses' => (int) $p->uses,
            'by' => $p->created_by_name,
        ];
    }

    private function clean(mixed $value): ?string
    {
        $value = is_string($value) ? trim($value) : null;

        return $value === '' ? null : $value;
    }
}
