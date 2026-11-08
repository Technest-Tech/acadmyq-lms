<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AcademyBilling;
use App\Services\ModuleBilling;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Super Admin management of an academy's SaaS subscription (Platform↔Academy billing): the
 * trial window, activation/period, and the snapshot total cost. Gated by the Super-Admin-only
 * `academy_billing.manage` capability; every write runs in the target academy's context (so the
 * tenant `with check` admits it) and is audited.
 *
 * `mySummary` is the one owner-facing endpoint — the academy owner reads their OWN subscription
 * for the dashboard (no special capability; tenant.context scopes the read to their academy).
 */
final class AcademySubscriptionController extends Controller
{
    public function __construct(
        private readonly AcademyBilling $billing,
        private readonly ModuleBilling $modules,
    ) {}

    /** GET /admin/academies/{id}/subscription — the subscription + its plan/add-on cost breakdown. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $payload = $this->inAcademyContext($id, function () use ($id) {
            $sub = $this->billing->ensureSubscription($id);
            $plan = ($sub->plan_id ?? null) !== null
                ? DB::table('plans')->where('id', $sub->plan_id)->first(['code', 'name', 'price_minor', 'currency'])
                : null;
            $addOns = DB::table('academy_addons as aa')
                ->join('add_ons as ao', 'ao.id', '=', 'aa.add_on_id')
                ->where('aa.academy_id', $id)
                ->where('aa.is_active', true)
                ->orderBy('ao.name')
                ->get(['ao.code', 'ao.name', 'ao.price_minor', 'ao.currency']);

            return ['subscription' => $sub, 'plan' => $plan, 'addOns' => $addOns];
        });

        return response()->json($payload);
    }

    /** PUT /admin/academies/{id}/subscription — adjust interval / period / activation dates. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'billing_interval' => ['sometimes', Rule::in(['MONTHLY', 'YEARLY'])],
            'activated_at' => ['sometimes', 'nullable', 'date'],
            'current_period_start' => ['sometimes', 'nullable', 'date'],
            'current_period_end' => ['sometimes', 'nullable', 'date'],
        ]);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $data, $ctx) {
            $fields = array_intersect_key($data, array_flip([
                'billing_interval', 'activated_at', 'current_period_start', 'current_period_end',
            ]));

            // R1: the write goes to the PRIMARY module sub; the legacy row is its mirror (returned
            // here so the existing panel keeps its response shape until R2 rewires it).
            if ($fields !== []) {
                $moduleSub = $this->modules->setFields($id, $this->modules->primaryModule($id), $fields);
                Audit::log('academy_subscription.updated', 'academy_subscription', $moduleSub->id, $id, $ctx->userId, 'SUPER_ADMIN', after: $fields);
            }

            return $this->billing->currentSubscription($id) ?? $this->billing->ensureSubscription($id);
        });

        return response()->json(['subscription' => $sub]);
    }

    /** POST /admin/academies/{id}/subscription/trial/extend — extend the trial by N days. */
    public function extendTrial(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $data = $request->validate(['days' => ['required', 'integer', 'min:1', 'max:365']]);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $data, $ctx) {
            $before = $this->billing->currentSubscription($id);

            // R1: the trial clock lives on the PRIMARY module sub; the legacy row mirrors it.
            $moduleSub = $this->modules->extendTrial($id, $this->modules->primaryModule($id), (int) $data['days']);

            Audit::log('academy_subscription.trial_extended', 'academy_subscription', $moduleSub->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['trial_end' => $moduleSub->trial_end, 'days' => (int) $data['days']],
                before: ['trial_end' => $before->trial_end ?? null]);

            return $this->billing->currentSubscription($id);
        });

        return response()->json(['subscription' => $sub]);
    }

    /** POST /admin/academies/{id}/subscription/activate — convert a trial to a paid subscription. */
    public function activate(string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $ctx) {
            // R1: activation happens on the PRIMARY module sub; the legacy row mirrors it.
            $moduleSub = $this->modules->activate($id, $this->modules->primaryModule($id));
            Audit::log('academy_subscription.activated', 'academy_subscription', $moduleSub->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['activated_at' => $moduleSub->activated_at, 'current_period_end' => $moduleSub->current_period_end]);

            return $this->billing->currentSubscription($id);
        });

        return response()->json(['subscription' => $sub]);
    }

    /** GET /my-subscription — the caller's OWN academy subscription (owner dashboard widget). */
    public function mySummary(): JsonResponse
    {
        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            return response()->json(['subscription' => null]);
        }

        $sub = $this->billing->ensureSubscription($ctx->academyId);

        // What the academy owes the platform, from the owner's accounts book — shown only to the
        // academy's owner (a teacher or a supervisor has no business with the school's bill).
        $account = null;
        if ($ctx->role === 'ACADEMY_OWNER') {
            $raw = DB::selectOne('select app.my_account_dues() as d')->d ?? null;
            $account = is_string($raw) ? json_decode($raw, true) : null;
        }

        return response()->json(['subscription' => $sub, 'account' => $account]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function assertAcademyExists(string $id): void
    {
        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }
    }

    /**
     * Run $fn inside the target academy's tenant context as Super Admin (the audited cross-tenant
     * path) so RLS `with check` admits the writes. Mirrors AcademyController::inAcademyContext.
     *
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
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
