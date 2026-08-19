<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
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
 * R1 (docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN) — the client-first Super Admin surface:
 * the cross-tenant client directory (module chips per client) and the per-module subscription
 * lifecycle. These endpoints are THE one writer for module on/off / plan / trial / activate /
 * pause ("one writer per fact"); the legacy /admin/academies/* endpoints stay as aliases through
 * the transition and now write through the same ModuleBilling engine.
 *
 * Reads are gated by `academy.read` (roster) and writes by `academy_billing.manage`, matching the
 * existing academy/subscription surfaces. Every write runs inside the target academy's tenant
 * context and is audited.
 */
final class ClientController extends Controller
{
    public function __construct(private readonly ModuleBilling $modules) {}

    /** GET /admin/clients — every client with its per-module subscription summary. */
    public function index(): JsonResponse
    {
        Gate::authorize('academy.read');

        $data = json_decode(DB::selectOne('select app.admin_client_directory() as d')->d, true);

        return response()->json($data);
    }

    /**
     * POST /admin/clients — provision a WHATSAPP-ONLY external client (R4, M-CLI-2): a lightweight
     * academies row with NO owner login (nobody can ever sign in) and a WHATSAPP module
     * subscription. The admin connects it by QR from the client page and serves it over the
     * external API; a lapsed subscription blocks sends via the entitlement gate. Full clients
     * (with a management login) keep using the wizard's POST /admin/academies flow.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('academy.create');
        Gate::authorize('academy_billing.manage');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'mode' => ['required', Rule::in(['trial', 'active'])],
            'trial_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
            'price_minor' => ['nullable', 'integer', 'min:0'],
            'billing_interval' => ['sometimes', Rule::in(['MONTHLY', 'YEARLY'])],
            'default_currency' => ['sometimes', 'string', 'size:3'],
            'timezone' => ['sometimes', 'string', 'max:64'],
        ]);
        $ctx = app(AuthContext::class);

        // The client identity still needs an academy type (NOT NULL); external clients take the
        // dedicated EXTERNAL type when seeded, else the first catalog entry — they never render
        // report fields, so the template is irrelevant.
        $typeId = DB::table('academy_types')->where('code', 'EXTERNAL')->value('id')
            ?? DB::table('academy_types')->orderBy('created_at')->value('id');
        if ($typeId === null) {
            abort(422, 'No academy types exist yet — create one first.');
        }

        $clientId = (string) Str::uuid();
        $this->inAcademyContext($clientId, function () use ($clientId, $data, $typeId, $ctx) {
            DB::table('academies')->insert([
                'id' => $clientId,
                'name' => $data['name'],
                'academy_type_id' => $typeId,
                'client_type' => 'WHATSAPP',
                'status' => 'ACTIVE',
                'plan_id' => null,
                'default_currency' => strtoupper((string) ($data['default_currency'] ?? 'EGP')),
                'timezone' => $data['timezone'] ?? 'Africa/Cairo',
                'invoice_grouping' => 'PER_GUARDIAN',
                'billing_day' => 1,
            ]);

            Audit::log('client.whatsapp_only_created', 'academy', $clientId, $clientId, $ctx->userId, 'SUPER_ADMIN', after: [
                'name' => $data['name'],
                'client_type' => 'WHATSAPP',
                'mode' => $data['mode'],
            ]);

            $sub = $this->modules->enable(
                $clientId,
                'WHATSAPP',
                trial: $data['mode'] === 'trial',
                trialDays: isset($data['trial_days']) ? (int) $data['trial_days'] : null,
                priceMinor: isset($data['price_minor']) ? (int) $data['price_minor'] : null,
                currency: $data['default_currency'] ?? null,
                interval: $data['billing_interval'] ?? null,
            );

            Audit::log('module_subscription.enabled', 'module_subscription', $sub->id, $clientId, $ctx->userId, 'SUPER_ADMIN', after: [
                'module' => 'WHATSAPP',
                'mode' => $data['mode'],
                'price_minor' => $sub->base_price_minor,
                'external' => true,
            ]);
        });

        return response()->json(['clientId' => $clientId], 201);
    }

    /** GET /admin/clients/{id} — one client: academy facts + module subscriptions + add-ons. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('academy.read');
        $this->assertAcademyExists($id);

        $payload = $this->inAcademyContext($id, function () use ($id) {
            $academy = DB::table('academies')->where('id', $id)->first([
                'id', 'name', 'client_type', 'status', 'suspended_at', 'suspended_reason', 'plan_id',
                'default_currency', 'timezone', 'invoice_grouping', 'billing_day',
                'brand_display_name', 'brand_logo_url', 'subdomain', 'created_at',
            ]);

            return [
                'client' => $academy,
                'catalog' => $this->featureCatalogFor((string) ($academy->client_type ?? 'MANAGEMENT')),
                'modules' => $this->moduleRows($id),
                'addOns' => DB::table('academy_addons as aa')
                    ->join('add_ons as ao', 'ao.id', '=', 'aa.add_on_id')
                    ->where('aa.academy_id', $id)
                    ->where('aa.is_active', true)
                    ->orderBy('ao.name')
                    ->get(['ao.code', 'ao.name', 'ao.feature_key', 'ao.price_minor', 'ao.currency']),
            ];
        });

        return response()->json($payload);
    }

    /**
     * POST /admin/clients/{id}/modules/{module}/subscription — enable the module: attach a plan
     * and start either a trial (days default from Settings) or an immediately-active paid period.
     */
    public function enableModule(Request $request, string $id, string $module): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $module = $this->normalizeModule($module);
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'mode' => ['required', Rule::in(['trial', 'active'])],
            'trial_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
            'price_minor' => ['nullable', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'billing_interval' => ['sometimes', Rule::in(['MONTHLY', 'YEARLY'])],
        ]);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $module, $data, $ctx) {
            $sub = $this->modules->enable(
                $id,
                $module,
                trial: $data['mode'] === 'trial',
                trialDays: isset($data['trial_days']) ? (int) $data['trial_days'] : null,
                priceMinor: isset($data['price_minor']) ? (int) $data['price_minor'] : null,
                currency: $data['currency'] ?? null,
                interval: $data['billing_interval'] ?? null,
            );

            Audit::log('module_subscription.enabled', 'module_subscription', $sub->id, $id, $ctx->userId, 'SUPER_ADMIN', after: [
                'module' => $module,
                'mode' => $data['mode'],
                'price_minor' => $sub->base_price_minor,
                'currency' => $sub->currency,
                'trial_end' => $sub->trial_end,
            ]);

            return $sub;
        });

        return response()->json(['subscription' => $sub], 201);
    }

    /**
     * PUT /admin/clients/{id}/modules/{module}/subscription — what this client pays for this module
     * (05 §5: price, currency and interval live on the client's own row) plus the period dates.
     */
    public function updateModule(Request $request, string $id, string $module): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $module = $this->normalizeModule($module);
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'price_minor' => ['sometimes', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'billing_interval' => ['sometimes', Rule::in(['MONTHLY', 'YEARLY'])],
            'activated_at' => ['sometimes', 'nullable', 'date'],
            'current_period_start' => ['sometimes', 'nullable', 'date'],
            'current_period_end' => ['sometimes', 'nullable', 'date'],
        ]);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $module, $data, $ctx) {
            $before = $this->modules->current($id, $module);

            $priced = array_intersect_key($data, array_flip(['price_minor', 'currency', 'billing_interval']));
            if ($priced !== []) {
                $this->modules->setPricing(
                    $id,
                    $module,
                    priceMinor: isset($data['price_minor']) ? (int) $data['price_minor'] : null,
                    currency: $data['currency'] ?? null,
                    interval: $data['billing_interval'] ?? null,
                );
            }

            $fields = array_intersect_key($data, array_flip([
                'billing_interval', 'activated_at', 'current_period_start', 'current_period_end',
            ]));
            $sub = $fields !== []
                ? $this->modules->setFields($id, $module, $fields)
                : $this->modules->current($id, $module);

            if ($sub === null) {
                abort(404, 'That module is not enabled for this client.');
            }

            Audit::log('module_subscription.updated', 'module_subscription', $sub->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['module' => $module] + $data,
                before: [
                    'price_minor' => $before->base_price_minor ?? null,
                    'currency' => $before->currency ?? null,
                    'billing_interval' => $before->billing_interval ?? null,
                ]);

            return $sub;
        });

        return response()->json(['subscription' => $sub]);
    }

    /**
     * PUT /admin/clients/{id}/modules/{module}/features — the per-client feature switches (05 §4).
     * `disabled` is the exception list: everything the module owns stays granted except these keys.
     * `limits` is the optional cap map for that module (an absent key means unlimited).
     */
    public function updateModuleFeatures(Request $request, string $id, string $module): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $module = $this->normalizeModule($module);
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'disabled' => ['sometimes', 'array'],
            'disabled.*' => ['string', Rule::in(FeatureCatalog::capabilitiesOfModule($module))],
            'limits' => ['sometimes', 'nullable', 'array'],
        ]);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $module, $data, $request, $ctx) {
            $sub = $this->modules->current($id, $module);
            if ($sub === null) {
                abort(404, 'That module is not enabled for this client.');
            }

            if (array_key_exists('disabled', $data)) {
                $sub = $this->modules->setDisabledFeatures($id, $module, array_values($data['disabled'])) ?? $sub;
            }

            if ($request->has('limits')) {
                $sub = $this->modules->setLimitOverrides($id, $module, $this->cleanLimits($module, $data['limits'] ?? [])) ?? $sub;
            }

            Audit::log('module_subscription.features', 'module_subscription', $sub->id, $id, $ctx->userId, 'SUPER_ADMIN', after: [
                'module' => $module,
                'disabled' => $data['disabled'] ?? null,
                'limits' => $data['limits'] ?? null,
            ]);

            return $sub;
        });

        return response()->json(['subscription' => $sub]);
    }

    /** POST /admin/clients/{id}/modules/{module}/subscription/trial — start/extend the trial. */
    public function extendTrial(Request $request, string $id, string $module): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $module = $this->normalizeModule($module);
        $this->assertAcademyExists($id);

        $data = $request->validate(['days' => ['required', 'integer', 'min:1', 'max:3650']]);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $module, $data, $ctx) {
            $before = $this->modules->current($id, $module);
            $sub = $this->modules->extendTrial($id, $module, (int) $data['days']);

            Audit::log('module_subscription.trial_extended', 'module_subscription', $sub->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['module' => $module, 'trial_end' => $sub->trial_end, 'days' => (int) $data['days']],
                before: ['trial_end' => $before->trial_end ?? null]);

            return $sub;
        });

        return response()->json(['subscription' => $sub]);
    }

    /** POST /admin/clients/{id}/modules/{module}/subscription/activate — trial/paused → paid. */
    public function activateModule(string $id, string $module): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $module = $this->normalizeModule($module);
        $this->assertAcademyExists($id);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $module, $ctx) {
            $sub = $this->modules->activate($id, $module);
            Audit::log('module_subscription.activated', 'module_subscription', $sub->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['module' => $module, 'activated_at' => $sub->activated_at, 'current_period_end' => $sub->current_period_end]);

            return $sub;
        });

        return response()->json(['subscription' => $sub]);
    }

    /** POST /admin/clients/{id}/modules/{module}/subscription/pause — scoped suspension (M-BILL-2). */
    public function pauseModule(string $id, string $module): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $module = $this->normalizeModule($module);
        $this->assertAcademyExists($id);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $module, $ctx) {
            $sub = $this->modules->pause($id, $module);
            if ($sub === null) {
                abort(404, 'No live subscription for this module.');
            }
            Audit::log('module_subscription.paused', 'module_subscription', $sub->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['module' => $module]);

            return $sub;
        });

        return response()->json(['subscription' => $sub]);
    }

    /** POST /admin/clients/{id}/modules/{module}/subscription/end — remove the module (history). */
    public function endModule(string $id, string $module): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $module = $this->normalizeModule($module);
        $this->assertAcademyExists($id);
        $ctx = app(AuthContext::class);

        $this->inAcademyContext($id, function () use ($id, $module, $ctx) {
            $before = $this->modules->current($id, $module);
            if ($before === null) {
                abort(404, 'No live subscription for this module.');
            }
            $this->modules->end($id, $module);
            Audit::log('module_subscription.ended', 'module_subscription', $before->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['module' => $module], before: ['plan_id' => $before->plan_id, 'status' => $before->status]);
        });

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** The client's live module subs joined to their plans (read inside the academy context). */
    private function moduleRows(string $id): mixed
    {
        return DB::table('module_subscriptions as ms')
            ->leftJoin('plans as p', 'p.id', '=', 'ms.plan_id')
            ->where('ms.academy_id', $id)
            ->where('ms.status', '<>', 'ENDED')
            ->orderBy('ms.module')
            ->get([
                'ms.id', 'ms.module', 'ms.status', 'ms.is_trial', 'ms.trial_start', 'ms.trial_end',
                'ms.activated_at', 'ms.current_period_start', 'ms.current_period_end',
                'ms.billing_interval', 'ms.base_price_minor', 'ms.addons_price_minor',
                'ms.total_cost_minor', 'ms.currency', 'ms.overrides', 'ms.plan_id',
                'p.code as plan_code', 'p.name as plan_name',
            ]);
    }

    /**
     * What this client's type may hold and, per module, the features and caps a Super Admin can
     * switch — the profile page renders its toggles straight off this, so the panel can never offer
     * a key the resolver doesn't honour.
     *
     * @return array{clientType: string, allowedModules: list<string>, modules: array<string, array{capabilities: array<string,string>, limits: array<string,string>}>}
     */
    private function featureCatalogFor(string $clientType): array
    {
        $modules = [];
        foreach (FeatureCatalog::CLIENT_TYPE_MODULES[$clientType] ?? [] as $module) {
            $capabilities = [];
            foreach (FeatureCatalog::capabilitiesOfModule($module) as $key) {
                $capabilities[$key] = FeatureCatalog::CAPABILITIES[$key] ?? $key;
            }

            $limits = [];
            foreach (FeatureCatalog::limitKeysOfModule($module) as $key) {
                $limits[$key] = FeatureCatalog::LIMITS[$key] ?? FeatureCatalog::FLAGS[$key] ?? $key;
            }

            $modules[$module] = ['capabilities' => $capabilities, 'limits' => $limits];
        }

        return [
            'clientType' => $clientType,
            'allowedModules' => FeatureCatalog::CLIENT_TYPE_MODULES[$clientType] ?? [],
            'modules' => $modules,
        ];
    }

    /**
     * Keep only the caps that belong to $module and drop the blanks — an empty map CLEARS the
     * override, which is how a client goes back to uncapped.
     *
     * @param  array<string,mixed>  $limits
     * @return array<string,int>
     */
    private function cleanLimits(string $module, array $limits): array
    {
        $clean = [];
        foreach (FeatureCatalog::limitKeysOfModule($module) as $key) {
            if (! array_key_exists($key, $limits) || $limits[$key] === null || $limits[$key] === '') {
                continue;
            }
            $value = $limits[$key];
            $clean[$key] = is_bool($value) ? (int) $value : (int) $value;
        }

        return $clean;
    }

    /** Route segment → module code; unknown segments 404 (the route is enum-like, not user data). */
    private function normalizeModule(string $module): string
    {
        $module = strtoupper($module);
        if (! in_array($module, ModuleBilling::MODULES, true)) {
            abort(404, 'Unknown module.');
        }

        return $module;
    }

    private function assertAcademyExists(string $id): void
    {
        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }
    }

    /** Run $fn in the target academy's context as SUPER_ADMIN (mirrors AcademyController). */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(
            userId: $ctx->userId,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $ctx->permissions,
        );

        return Tenancy::withContext($target, $fn);
    }
}
