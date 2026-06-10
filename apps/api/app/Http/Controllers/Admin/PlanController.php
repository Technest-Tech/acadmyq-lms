<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Platform plan & add-on catalog CRUD (Sprint 3 §7), gated by `plan.manage` (Super Admin
 * only — an Owner gets 403, TC-3.24). These are platform-level rows (no academy_id); the
 * catalog RLS admits writes only under `app.is_super_admin()`, so the Gate and RLS agree.
 *
 * Selecting a plan for an academy is configuration, not entitlement — Sprint 3 only STORES
 * the plan_id; feature gating from it is Sprint 9 (AC-3.8).
 */
final class PlanController extends Controller
{
    /** GET /api/admin/plans — the full plan + add-on catalog. */
    public function index(): JsonResponse
    {
        Gate::authorize('plan.manage');

        return response()->json([
            'plans' => DB::table('plans')->orderBy('price_minor')->get(),
            'addOns' => DB::table('add_ons')->orderBy('code')->get(),
        ]);
    }

    /** POST /api/admin/plans — create a plan. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('plan.manage');

        $data = $request->validate([
            'code' => ['required', 'string', 'max:64', Rule::unique('plans', 'code')],
            'name' => ['required', 'string', 'max:255'],
            'price_minor' => ['required', 'integer', 'min:0'],
            'currency' => ['required', 'string', 'size:3'],
            'features' => ['nullable', 'array'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $id = (string) Str::uuid();
        DB::table('plans')->insert([
            'id' => $id,
            'code' => $data['code'],
            'name' => $data['name'],
            'price_minor' => $data['price_minor'],
            'currency' => strtoupper($data['currency']),
            'features' => json_encode($data['features'] ?? (object) []),
            'is_active' => $data['is_active'] ?? true,
        ]);

        $this->audit('plan', $id, ['created' => $data['code']]);

        return response()->json(['planId' => $id], 201);
    }

    /** PATCH /api/admin/plans/{id} — update a plan. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('plan.manage');

        if (DB::table('plans')->where('id', $id)->doesntExist()) {
            abort(404, 'Plan not found.');
        }

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'price_minor' => ['sometimes', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'features' => ['sometimes', 'array'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $update = $data;
        if (isset($update['currency'])) {
            $update['currency'] = strtoupper($update['currency']);
        }
        if (array_key_exists('features', $update)) {
            $update['features'] = json_encode($update['features']);
        }

        if ($update !== []) {
            DB::table('plans')->where('id', $id)->update($update + ['updated_at' => now()]);
        }
        $this->audit('plan', $id, ['updated' => array_keys($data)]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/admin/add-ons — create an add-on. */
    public function storeAddOn(Request $request): JsonResponse
    {
        Gate::authorize('plan.manage');

        $data = $request->validate([
            'code' => ['required', 'string', 'max:64', Rule::unique('add_ons', 'code')],
            'name' => ['required', 'string', 'max:255'],
            'price_minor' => ['required', 'integer', 'min:0'],
            'currency' => ['required', 'string', 'size:3'],
            'feature_key' => ['required', 'string', 'max:64'],
        ]);

        $id = (string) Str::uuid();
        DB::table('add_ons')->insert([
            'id' => $id,
            'code' => $data['code'],
            'name' => $data['name'],
            'price_minor' => $data['price_minor'],
            'currency' => strtoupper($data['currency']),
            'feature_key' => $data['feature_key'],
        ]);

        $this->audit('add_on', $id, ['created' => $data['code']]);

        return response()->json(['addOnId' => $id], 201);
    }

    /** PATCH /api/admin/add-ons/{id} — update an add-on. */
    public function updateAddOn(Request $request, string $id): JsonResponse
    {
        Gate::authorize('plan.manage');

        if (DB::table('add_ons')->where('id', $id)->doesntExist()) {
            abort(404, 'Add-on not found.');
        }

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'price_minor' => ['sometimes', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'feature_key' => ['sometimes', 'string', 'max:64'],
        ]);

        $update = $data;
        if (isset($update['currency'])) {
            $update['currency'] = strtoupper($update['currency']);
        }

        if ($update !== []) {
            DB::table('add_ons')->where('id', $id)->update($update + ['updated_at' => now()]);
        }
        $this->audit('add_on', $id, ['updated' => array_keys($data)]);

        return response()->json(['ok' => true]);
    }

    /** Platform-level audit (no academy_id): a plan/add-on change is not tenant-scoped. */
    private function audit(string $entityType, string $entityId, array $after): void
    {
        $ctx = app(AuthContext::class);
        Audit::log('plan.manage', $entityType, $entityId, null, $ctx->userId, $ctx->role, after: $after);
    }
}
