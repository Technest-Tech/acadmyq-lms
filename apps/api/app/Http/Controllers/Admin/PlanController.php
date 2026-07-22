<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AcademyBilling;
use App\Services\ModuleBilling;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\FeatureCatalog;
use App\Support\Tenancy;
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

        // `features` is a jsonb column; the query builder hands it back as a raw JSON string.
        // Decode it so the client receives the documented { capabilities, limits } object
        // (otherwise every limit reads as "unlimited" and every capability as off).
        $plans = DB::table('plans')->orderBy('price_minor')->get()->map(function ($plan) {
            $plan->features = is_string($plan->features)
                ? (json_decode($plan->features, true) ?: (object) [])
                : $plan->features;

            return $plan;
        });

        return response()->json([
            'plans' => $plans,
            'addOns' => DB::table('add_ons')->orderBy('code')->get(),
        ]);
    }

    /** GET /api/admin/capabilities — the gated-feature catalog the plan/add-on forms offer. */
    public function capabilities(): JsonResponse
    {
        Gate::authorize('plan.manage');

        return response()->json(FeatureCatalog::all());
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
            // R1: a plan belongs to exactly one sellable module (plans.module, M-UI-2).
            'module' => ['sometimes', Rule::in(['MANAGEMENT', 'WHATSAPP', 'VIDEO', 'CRM'])],
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
            'module' => $data['module'] ?? 'MANAGEMENT',
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
            'module' => ['sometimes', Rule::in(['MANAGEMENT', 'WHATSAPP', 'VIDEO', 'CRM'])],
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

        // A price/currency/features change must propagate to the snapshot cost of every
        // subscription sitting on this plan — otherwise those academies keep being billed (and
        // shown) the old amount until something else touches their subscription.
        $affectsCost = array_key_exists('price_minor', $data)
            || array_key_exists('currency', $data)
            || array_key_exists('features', $data);
        if ($affectsCost) {
            $this->resyncSubscriptionsForPlan($id);
        }

        return response()->json(['ok' => true]);
    }

    /**
     * Recompute the snapshot cost of every academy currently on $planId, each inside its own
     * tenant context (RLS `with check`). Keeps subscriptions in sync after a plan-catalog edit.
     * R1: module-engine academies reprice per module sub (which refreshes the legacy mirror);
     * legacy-only academies keep the old single-row recompute. Module subs on this plan are found
     * under a platform-level SUPER_ADMIN read (module_subscriptions is tenant-RLS'd).
     */
    private function resyncSubscriptionsForPlan(string $planId): void
    {
        $billing = app(AcademyBilling::class);
        $engine = app(ModuleBilling::class);
        $actorId = app(AuthContext::class)->userId;

        // module_subscriptions is tenant-RLS'd (hidden from a contextless Super Admin), so the plan's
        // users can only be found inside each academy's own context — enumerate academies (the
        // academies policy admits a Super Admin) and check per academy. Plan edits are rare; the
        // platform roster is small.
        foreach (DB::table('academies')->pluck('id') as $academyId) {
            $academyId = (string) $academyId;
            $ctx = new AuthContext(
                userId: $actorId,
                academyId: $academyId,
                role: 'SUPER_ADMIN',
                permissions: [],
            );
            Tenancy::withContext($ctx, function () use ($academyId, $planId, $billing, $engine) {
                $subs = $engine->all($academyId);
                $onModulePlan = $subs->contains(fn (object $s): bool => (string) $s->plan_id === $planId);
                $onLegacyPlan = (string) DB::table('academies')->where('id', $academyId)->value('plan_id') === $planId;

                if (! $onModulePlan && ! $onLegacyPlan) {
                    return;
                }

                $subs->isEmpty() ? $billing->recomputeTotals($academyId) : $engine->recompute($academyId);
            });
        }
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
