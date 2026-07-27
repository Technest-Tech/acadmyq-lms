<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Per-module subscription engine (R1, docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN §5) — THE
 * single writer of `module_subscriptions` lifecycle state. Each (client, module) pair holds at most
 * one live row (M-SUB-2); its `is_trial`/`trial_start`/`trial_end` are the ONLY trial clock for that
 * module, and its status drives scoped suspension (M-BILL-2): a PAUSED module contributes nothing to
 * entitlement while the client's other modules keep working.
 *
 * Legacy write-through mirrors (dropped in R5): after every mutation, syncLegacy() re-derives
 * `academies.plan_id`, the `academies.video_*` columns and the live `academy_subscriptions` row from
 * the module subs — the INVERSE of the Phase-1/2b ModuleSubscriptionBackfill direction — so every
 * not-yet-rewired admin read (billing overview, video oversight, owner /my-subscription) stays
 * correct through the transition. The mirrored legacy total is the SUM of the client's module totals
 * (one client, one bill — M-BILL-1); per-module invoice line items land with the R3 billing rebuild.
 *
 * Like AcademyBilling, every method assumes it runs INSIDE the target academy's tenant context so
 * RLS admits the writes, and the CALLER writes the audit entry (it knows the actor).
 */
final class ModuleBilling
{
    public const MODULES = ['MANAGEMENT', 'VIDEO', 'WHATSAPP', 'CRM', 'LMS'];

    /** Add-on feature_keys attributed to a non-MANAGEMENT module for pricing. */
    private const ADDON_MODULE = [
        'video.conferencing' => 'VIDEO',
        'whatsapp.automation' => 'WHATSAPP',
    ];

    // ── reads ────────────────────────────────────────────────────────────────

    /** The live (non-ENDED) subscription for one module, or null. Never creates a row. */
    public function current(string $academyId, string $module): ?object
    {
        return DB::table('module_subscriptions')
            ->where('academy_id', $academyId)
            ->where('module', $module)
            ->where('status', '<>', 'ENDED')
            ->first();
    }

    /** Every live (non-ENDED) module subscription for the client. */
    public function all(string $academyId): Collection
    {
        return DB::table('module_subscriptions')
            ->where('academy_id', $academyId)
            ->where('status', '<>', 'ENDED')
            ->orderBy('module')
            ->get();
    }

    /**
     * The client's primary module — the one whose plan mirrors to `academies.plan_id`: MANAGEMENT
     * when present, else VIDEO (a MEET video-only client), else whatever single module it has.
     */
    public function primaryModule(string $academyId): string
    {
        $modules = $this->all($academyId)->pluck('module')->all();

        if (in_array('MANAGEMENT', $modules, true)) {
            return 'MANAGEMENT';
        }
        if (in_array('VIDEO', $modules, true)) {
            return 'VIDEO';
        }

        return $modules[0] ?? 'MANAGEMENT';
    }

    // ── lifecycle (one writer per fact: these methods, nowhere else) ─────────

    /**
     * Enable a module for a client: create (or re-point) its live subscription on $planId, starting
     * either a trial (default length from config) or an immediately-active paid period. Restores a
     * suspended client's access — enabling a module is an explicit Super Admin grant.
     */
    public function enable(string $academyId, string $module, ?string $planId, bool $trial, ?int $trialDays = null): object
    {
        $this->assertModule($module);
        if ($planId !== null) {
            $this->assertPlanBelongs($planId, $module);
        }

        $sub = $this->ensure($academyId, $module);
        $now = now();

        if ($trial) {
            $days = $trialDays ?? (int) config('billing.trial_days', 5);
            $update = [
                'plan_id' => $planId,
                'status' => 'ACTIVE',
                'is_trial' => true,
                'trial_start' => $now,
                'trial_end' => $now->copy()->addDays($days),
                'updated_at' => $now,
            ];
        } else {
            $update = [
                'plan_id' => $planId,
                'status' => 'ACTIVE',
                'is_trial' => false,
                'trial_start' => null,
                'trial_end' => null,
                'activated_at' => $sub->activated_at ?? $now,
                'current_period_start' => $now,
                'current_period_end' => $this->periodEnd($now, (string) $sub->billing_interval),
                'updated_at' => $now,
            ];
        }

        // Enabling VIDEO for a client whose primary plan doesn't grant it must carry the ENABLED
        // override + the plan as the video TIER — the resolver grants video via the override
        // container (never a non-primary VIDEO plan's capabilities) and reads video limits from
        // overrides.tierPlanId. The grant stays gated by the sub's own lifecycle, so a pause or
        // lapsed trial still cuts the rooms (M-BILL-2).
        if ($module === 'VIDEO' && $this->primaryModule($academyId) !== 'VIDEO') {
            $ov = $this->decodeOverrides($sub->overrides);
            $ov['access'] = 'ENABLED';
            unset($ov['trialEnd']);
            if ($planId !== null) {
                $ov['tierPlanId'] = $planId;
            }
            $update['overrides'] = json_encode($ov);
        }

        DB::table('module_subscriptions')->where('id', $sub->id)->update($update);

        $this->recompute($academyId);
        $this->restoreAccess($academyId);

        return $this->current($academyId, $module);
    }

    /** Change the module's plan (same-module plans only); lifecycle/trial state is untouched. */
    public function changePlan(string $academyId, string $module, ?string $planId): object
    {
        $this->assertModule($module);
        if ($planId !== null) {
            $this->assertPlanBelongs($planId, $module);
        }

        $sub = $this->ensure($academyId, $module);
        $update = ['plan_id' => $planId, 'updated_at' => now()];

        // A non-primary VIDEO sub's plan doubles as its tier (limits come from overrides.tierPlanId).
        if ($module === 'VIDEO' && $this->primaryModule($academyId) !== 'VIDEO') {
            $ov = $this->decodeOverrides($sub->overrides);
            if ($planId !== null) {
                $ov['tierPlanId'] = $planId;
            } else {
                unset($ov['tierPlanId']);
            }
            $update['overrides'] = $ov === [] ? null : json_encode($ov);
        }

        DB::table('module_subscriptions')->where('id', $sub->id)->update($update);

        $this->recompute($academyId);

        return $this->current($academyId, $module);
    }

    /** (Re)start the module's trial window ending in $days (default from config). */
    public function startTrial(string $academyId, string $module, ?int $days = null): object
    {
        $this->assertModule($module);
        $sub = $this->ensure($academyId, $module);
        $days ??= (int) config('billing.trial_days', 5);
        $now = now();

        DB::table('module_subscriptions')->where('id', $sub->id)->update([
            'status' => 'ACTIVE',
            'is_trial' => true,
            'trial_start' => $now,
            'trial_end' => $now->copy()->addDays($days),
            'updated_at' => $now,
        ]);

        $this->recompute($academyId);
        $this->restoreAccess($academyId);

        return $this->current($academyId, $module);
    }

    /**
     * Extend the module's trial by $days from its current end (or from now when already lapsed),
     * re-activating a paused sub and restoring a suspended client's access — matching the legacy
     * extendTrial semantics the Super Admin already relies on.
     */
    public function extendTrial(string $academyId, string $module, int $days): object
    {
        $this->assertModule($module);
        $sub = $this->ensure($academyId, $module);

        $base = $sub->trial_end !== null ? Carbon::parse($sub->trial_end) : now();
        if ($base->isPast()) {
            $base = now();
        }

        DB::table('module_subscriptions')->where('id', $sub->id)->update([
            'status' => 'ACTIVE',
            'is_trial' => true,
            'trial_start' => $sub->trial_start ?? now(),
            'trial_end' => $base->copy()->addDays($days),
            'updated_at' => now(),
        ]);

        $this->recompute($academyId);
        $this->restoreAccess($academyId);

        return $this->current($academyId, $module);
    }

    /** Convert the module's trial (or paused sub) to live paid and open its first period. */
    public function activate(string $academyId, string $module): object
    {
        $this->assertModule($module);
        $sub = $this->ensure($academyId, $module);
        $now = now();

        DB::table('module_subscriptions')->where('id', $sub->id)->update([
            'status' => 'ACTIVE',
            'is_trial' => false,
            'activated_at' => $sub->activated_at ?? $now,
            'current_period_start' => $now,
            'current_period_end' => $this->periodEnd($now, (string) $sub->billing_interval),
            'updated_at' => $now,
        ]);

        $this->recompute($academyId);
        $this->restoreAccess($academyId);

        return $this->current($academyId, $module);
    }

    /**
     * Pause the module's subscription (scoped suspension, M-BILL-2): only this module's capabilities
     * drop. The client is fully SUSPENDED only when no ACTIVE module remains.
     */
    public function pause(string $academyId, string $module): ?object
    {
        $this->assertModule($module);
        $sub = $this->current($academyId, $module);
        if ($sub === null) {
            return null;
        }

        DB::table('module_subscriptions')->where('id', $sub->id)->update([
            'status' => 'PAUSED',
            'updated_at' => now(),
        ]);

        $this->suspendIfNothingActive($academyId, 'All module subscriptions paused');
        $this->syncLegacy($academyId);

        return $this->current($academyId, $module);
    }

    /** Remove the module from the client: the live sub becomes ENDED history (M-SUB-2). */
    public function end(string $academyId, string $module): void
    {
        $this->assertModule($module);
        $sub = $this->current($academyId, $module);
        if ($sub === null) {
            return;
        }

        DB::table('module_subscriptions')->where('id', $sub->id)->update([
            'status' => 'ENDED',
            'canceled_at' => now(),
            'updated_at' => now(),
        ]);

        $this->suspendIfNothingActive($academyId, 'All module subscriptions ended');
        $this->syncLegacy($academyId);
    }

    /** Adjust interval / activation / period dates on the module's sub (Super Admin correction). */
    public function setFields(string $academyId, string $module, array $fields): object
    {
        $this->assertModule($module);
        $sub = $this->ensure($academyId, $module);

        $allowed = array_intersect_key($fields, array_flip([
            'billing_interval', 'activated_at', 'current_period_start', 'current_period_end',
        ]));
        if ($allowed !== []) {
            DB::table('module_subscriptions')->where('id', $sub->id)->update($allowed + ['updated_at' => now()]);
        }

        $this->recompute($academyId);

        return $this->current($academyId, $module);
    }

    /**
     * Replace a module sub's per-academy limit override (`overrides.limits`) — the module-agnostic
     * form of what videoAccess() does for VIDEO, used by the LMS oversight page to raise or lower a
     * single client's course/learner/storage caps without minting a bespoke plan for them.
     *
     * Passing an empty/null map CLEARS the override, so the client falls back to its module plan's
     * caps. Deliberately operates on the EXISTING sub only (no ensure()): a plan-less sub conjured
     * here would read as a live module the client never bought — enabling the module is the client
     * page's job.
     *
     * @param  array<string,int>|null  $limits
     */
    public function setLimitOverrides(string $academyId, string $module, ?array $limits): ?object
    {
        $this->assertModule($module);
        $sub = $this->container($academyId, $module);
        if ($sub === null) {
            return null;
        }

        $ov = $this->decodeOverrides($sub->overrides);
        if ($limits !== null && $limits !== []) {
            $ov['limits'] = $limits;
        } else {
            unset($ov['limits']);
        }

        DB::table('module_subscriptions')->where('id', $sub->id)->update([
            'overrides' => $ov === [] ? null : json_encode($ov),
            'updated_at' => now(),
        ]);

        $this->recompute($academyId);

        return $this->container($academyId, $module);
    }

    /**
     * The live subscription that REPRESENTS a module for this client — the dedicated `$module` row
     * when one exists, else the live row whose PLAN belongs to that module.
     *
     * The second case is not an edge case: the academy-creation flow provisions a single-module
     * client as ONE `MANAGEMENT` row carrying that module's plan (an LMS client has no `LMS` row at
     * all). `current()` answers "is there a row named X", which is the right question for the
     * billing lifecycle; this answers "which row governs module X", which is the right question for
     * reading or overriding that module's settings.
     *
     * Resolution order matches `app.admin_lms_stats` / `app.admin_lms_academy`, so the API and the
     * cross-tenant readers can never disagree about which row governs.
     */
    public function container(string $academyId, string $module): ?object
    {
        $this->assertModule($module);

        return $this->current($academyId, $module)
            ?? DB::table('module_subscriptions as ms')
                ->join('plans as p', 'p.id', '=', 'ms.plan_id')
                ->where('ms.academy_id', $academyId)
                ->where('ms.status', '<>', 'ENDED')
                ->where('p.module', $module)
                ->orderByDesc('ms.created_at')
                ->first(['ms.*']);
    }

    /**
     * The legacy "set the academy's plan" semantics, module-first: the plan's own module decides the
     * client's PRIMARY sub (VIDEO for the MEET plan, else MANAGEMENT), carrying the previous
     * primary's lifecycle across a module switch (PRO↔MEET) exactly as the Phase-2b reconcile did.
     * Bundled WhatsApp follows the plan: a plan granting `whatsapp.automation` keeps a WA_BUNDLED
     * sub alive; losing it ends the WHATSAPP sub only when it sits on WA_BUNDLED (a paid standalone
     * WhatsApp sub survives management plan changes).
     */
    public function setPrimaryPlan(string $academyId, ?string $planId): void
    {
        $plan = $planId !== null
            ? DB::table('plans')->where('id', $planId)->first(['id', 'module', 'features'])
            : null;
        $newModule = ($plan->module ?? 'MANAGEMENT') === 'VIDEO' ? 'VIDEO' : 'MANAGEMENT';
        if (($plan->module ?? 'MANAGEMENT') === 'WHATSAPP') {
            throw ValidationException::withMessages(['plan_id' => ['A WhatsApp plan cannot be the primary plan.']]);
        }

        $oldPrimaryModule = $this->primaryModule($academyId);
        $oldPrimary = $this->current($academyId, $oldPrimaryModule);

        if ($oldPrimaryModule === $newModule || $oldPrimary === null) {
            // Same primary module (or nothing to carry): just re-point the plan.
            $sub = $this->ensure($academyId, $newModule);
            DB::table('module_subscriptions')->where('id', $sub->id)->update([
                'plan_id' => $plan->id ?? null,
                'updated_at' => now(),
            ]);
        } else {
            // Primary module switches (e.g. PRO → MEET): the new primary CARRIES the old lifecycle.
            $target = $this->ensure($academyId, $newModule);
            DB::table('module_subscriptions')->where('id', $target->id)->update([
                'plan_id' => $plan->id ?? null,
                'status' => $oldPrimary->status,
                'is_trial' => $oldPrimary->is_trial,
                'trial_start' => $oldPrimary->trial_start,
                'trial_end' => $oldPrimary->trial_end,
                'activated_at' => $oldPrimary->activated_at,
                'current_period_start' => $oldPrimary->current_period_start,
                'current_period_end' => $oldPrimary->current_period_end,
                'billing_interval' => $oldPrimary->billing_interval,
                'updated_at' => now(),
            ]);

            // The old primary ends — unless it is a VIDEO override container that must survive
            // (a MEET→BASIC switch keeps a video grant only when overrides say so).
            if ($oldPrimaryModule === 'VIDEO' && $this->hasOverrides($oldPrimary)) {
                DB::table('module_subscriptions')->where('id', $oldPrimary->id)->update([
                    'plan_id' => null,
                    'updated_at' => now(),
                ]);
            } else {
                DB::table('module_subscriptions')->where('id', $oldPrimary->id)->update([
                    'status' => 'ENDED',
                    'canceled_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        // Bundled WhatsApp follows the plan's capabilities (D6).
        $bundlesWhatsapp = in_array('whatsapp.automation', $this->capabilitiesOf($plan->features ?? null), true);
        $waBundledId = DB::table('plans')->where('code', 'WA_BUNDLED')->value('id');
        $wa = $this->current($academyId, 'WHATSAPP');
        if ($bundlesWhatsapp && $wa === null && $waBundledId !== null) {
            $sub = $this->ensure($academyId, 'WHATSAPP');
            DB::table('module_subscriptions')->where('id', $sub->id)->update([
                'plan_id' => $waBundledId,
                'updated_at' => now(),
            ]);
        } elseif (! $bundlesWhatsapp && $wa !== null && (string) $wa->plan_id === (string) $waBundledId) {
            DB::table('module_subscriptions')->where('id', $wa->id)->update([
                'status' => 'ENDED',
                'canceled_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->recompute($academyId);
    }

    /**
     * The video-oversight access verbs (enable / trial / extend_trial / disable / follow_plan /
     * set_tier), written module-first: the trial clock lives on the VIDEO sub's own trial columns
     * (the legacy `overrides.trialEnd` is cleared on first touch so old backfilled rows migrate to
     * the one clock), force-on/off + tier + limit overrides live in the sub's `overrides` jsonb.
     * A non-primary VIDEO sub left with no plan, no override and no trial is ended — same collapse
     * rule as the Phase-2b reconcile.
     */
    public function videoAccess(
        string $academyId,
        string $action,
        ?int $trialDays = null,
        bool $tierProvided = false,
        ?string $tierPlanId = null,
        bool $overridesProvided = false,
        ?array $limits = null,
    ): ?object {
        $sub = $this->current($academyId, 'VIDEO') ?? $this->ensure($academyId, 'VIDEO');
        $ov = $this->decodeOverrides($sub->overrides);
        $update = ['updated_at' => now()];
        $now = now();

        switch ($action) {
            case 'enable': // permanent grant
                $ov['access'] = 'ENABLED';
                unset($ov['trialEnd']);
                $update += ['status' => 'ACTIVE', 'is_trial' => false, 'trial_start' => null, 'trial_end' => null,
                    'activated_at' => $sub->activated_at ?? $now];
                break;
            case 'trial':
                $ov['access'] = 'ENABLED';
                unset($ov['trialEnd']);
                $update += ['status' => 'ACTIVE', 'is_trial' => true, 'trial_start' => $now,
                    'trial_end' => $now->copy()->addDays((int) $trialDays)];
                break;
            case 'extend_trial':
                $current = $sub->trial_end ?? $ov['trialEnd'] ?? null;
                $base = ($current !== null && now()->lt($current)) ? Carbon::parse($current) : now();
                $ov['access'] = 'ENABLED';
                unset($ov['trialEnd']);
                $update += ['status' => 'ACTIVE', 'is_trial' => true, 'trial_start' => $sub->trial_start ?? $now,
                    'trial_end' => $base->copy()->addDays((int) $trialDays)];
                break;
            case 'disable':
                $ov['access'] = 'DISABLED';
                unset($ov['trialEnd']);
                $update += ['is_trial' => false, 'trial_start' => null, 'trial_end' => null];
                break;
            case 'follow_plan':
                unset($ov['access'], $ov['trialEnd']);
                $update += ['is_trial' => false, 'trial_start' => null, 'trial_end' => null];
                break;
            case 'set_tier':
                break; // only the tier below changes
        }

        if ($tierProvided) {
            if ($tierPlanId !== null) {
                $ov['tierPlanId'] = $tierPlanId;
            } else {
                unset($ov['tierPlanId']);
            }
        }
        if ($overridesProvided) {
            if ($limits !== null && $limits !== []) {
                $ov['limits'] = $limits;
            } else {
                unset($ov['limits']);
            }
        }

        // Collapse an empty non-primary container (nothing left to carry).
        $isPrimary = $this->primaryModule($academyId) === 'VIDEO';
        $isTrial = (bool) ($update['is_trial'] ?? $sub->is_trial);
        if (! $isPrimary && $ov === [] && $sub->plan_id === null && ! $isTrial) {
            $this->end($academyId, 'VIDEO');

            return null;
        }

        $update['overrides'] = $ov === [] ? null : json_encode($ov);
        DB::table('module_subscriptions')->where('id', $sub->id)->update($update);

        $this->recompute($academyId);

        return $this->current($academyId, 'VIDEO');
    }

    /**
     * Expire every lapsed module trial for the client (daily job): each lapsed trial's sub goes
     * PAUSED (scoped, M-BILL-2); the client is SUSPENDED only when NO active module remains (and
     * config('billing.trial_expiry_suspends') allows). Idempotent.
     *
     * @return array{expired: list<string>, suspended: bool}
     */
    public function expireTrialsFor(string $academyId): array
    {
        $now = now();
        $expired = [];

        foreach ($this->all($academyId) as $sub) {
            if ($sub->status !== 'ACTIVE' || ! $sub->is_trial || $sub->trial_end === null) {
                continue;
            }
            if (Carbon::parse($sub->trial_end)->isFuture()) {
                continue;
            }

            DB::table('module_subscriptions')->where('id', $sub->id)->update([
                'status' => 'PAUSED',
                'updated_at' => $now,
            ]);
            $expired[] = (string) $sub->module;
        }

        $suspended = false;
        if ($expired !== [] && (bool) config('billing.trial_expiry_suspends', true)) {
            $suspended = $this->suspendIfNothingActive($academyId, 'Trial expired');
        }
        if ($expired !== []) {
            $this->syncLegacy($academyId);
        }

        return ['expired' => $expired, 'suspended' => $suspended];
    }

    // ── pricing + legacy mirror ──────────────────────────────────────────────

    /**
     * Recompute every live sub's snapshot cost (its plan's price + the add-ons attributed to its
     * module in the sub's currency), then refresh the legacy mirror. Add-on attribution: an add-on
     * unlocking a video/whatsapp key prices onto that module's sub when one exists, else onto the
     * primary sub — so the client-wide sum always equals the legacy plan+add-ons total.
     */
    public function recompute(string $academyId): void
    {
        $subs = $this->all($academyId);
        if ($subs->isEmpty()) {
            $this->syncLegacy($academyId);

            return;
        }

        $academyCurrency = (string) (DB::table('academies')->where('id', $academyId)->value('default_currency') ?? 'EGP');
        $primaryModule = $this->primaryModule($academyId);

        $plans = DB::table('plans')
            ->whereIn('id', $subs->pluck('plan_id')->filter()->unique()->all())
            ->get(['id', 'price_minor', 'currency'])
            ->keyBy('id');

        $addOns = DB::table('academy_addons as aa')
            ->join('add_ons as ao', 'ao.id', '=', 'aa.add_on_id')
            ->where('aa.academy_id', $academyId)
            ->where('aa.is_active', true)
            ->get(['ao.feature_key', 'ao.price_minor', 'ao.currency']);

        $liveModules = $subs->pluck('module')->all();

        foreach ($subs as $sub) {
            $plan = $sub->plan_id !== null ? ($plans[(string) $sub->plan_id] ?? null) : null;
            $currency = (string) ($plan->currency ?? $sub->currency ?? $academyCurrency);
            $base = (int) ($plan->price_minor ?? 0);

            $addons = 0;
            foreach ($addOns as $addOn) {
                $target = self::ADDON_MODULE[(string) $addOn->feature_key] ?? 'MANAGEMENT';
                if (! in_array($target, $liveModules, true)) {
                    $target = $primaryModule; // no sub for that module — price it on the primary
                }
                if ($target === $sub->module && (string) $addOn->currency === $currency) {
                    $addons += (int) $addOn->price_minor;
                }
            }

            DB::table('module_subscriptions')->where('id', $sub->id)->update([
                'base_price_minor' => $base,
                'addons_price_minor' => $addons,
                'total_cost_minor' => $base + $addons,
                'currency' => $currency,
                'updated_at' => now(),
            ]);
        }

        $this->syncLegacy($academyId);
    }

    /**
     * Write-through mirror (legacy reads only; removed in R5): re-derive `academies.plan_id`, the
     * `academies.video_*` columns and the live `academy_subscriptions` row from the module subs —
     * the exact inverse of the Phase-1 backfill fold, so resolveLegacy(), the current admin pages
     * and /my-subscription keep telling the same story the module engine wrote.
     */
    public function syncLegacy(string $academyId): void
    {
        $subs = $this->all($academyId)->keyBy('module');

        // Never mirror for an academy the engine has never touched (no module rows at all, live or
        // ended) — nulling plan_id / pausing its legacy sub would wreck a legacy-only academy.
        if ($subs->isEmpty() && DB::table('module_subscriptions')->where('academy_id', $academyId)->doesntExist()) {
            return;
        }
        $mgmt = $subs['MANAGEMENT'] ?? null;
        $video = $subs['VIDEO'] ?? null;
        $primary = $mgmt ?? $video ?? $subs->first();

        // academies.plan_id + video_* mirror.
        $ov = $video !== null ? $this->decodeOverrides($video->overrides) : [];
        $videoTrialEnd = null;
        if ($video !== null) {
            $videoTrialEnd = ($video->is_trial && $video->trial_end !== null)
                ? $video->trial_end
                : ($ov['trialEnd'] ?? null);
        }

        DB::table('academies')->where('id', $academyId)->update([
            'plan_id' => $primary->plan_id ?? null,
            'video_access' => $ov['access'] ?? null,
            'video_trial_ends_at' => $videoTrialEnd,
            'video_plan_id' => $ov['tierPlanId'] ?? (($video !== null && $video !== $primary) ? $video->plan_id : null),
            'video_overrides' => isset($ov['limits']) && $ov['limits'] !== []
                ? json_encode(['limits' => $ov['limits']])
                : null,
            'updated_at' => now(),
        ]);

        // academy_subscriptions mirror: the primary lifecycle + the client-wide consolidated total.
        $legacy = DB::table('academy_subscriptions')
            ->where('academy_id', $academyId)
            ->where('status', '<>', 'ENDED')
            ->orderByDesc('created_at')
            ->first();

        if ($primary === null) {
            if ($legacy !== null) {
                DB::table('academy_subscriptions')->where('id', $legacy->id)
                    ->update(['status' => 'PAUSED', 'updated_at' => now()]);
            }

            return;
        }

        $currency = (string) $primary->currency;
        $total = (int) $subs->where('currency', $currency)->sum('total_cost_minor');
        $mirror = [
            'plan_id' => $primary->plan_id,
            'status' => $primary->status,
            'is_trial' => (bool) $primary->is_trial,
            'trial_start' => $primary->trial_start,
            'trial_end' => $primary->trial_end,
            'activated_at' => $primary->activated_at,
            'current_period_start' => $primary->current_period_start,
            'current_period_end' => $primary->current_period_end,
            'billing_interval' => $primary->billing_interval,
            'base_price_minor' => (int) $primary->base_price_minor,
            'addons_price_minor' => $total - (int) $primary->base_price_minor,
            'total_cost_minor' => $total,
            'currency' => $currency,
            'updated_at' => now(),
        ];

        if ($legacy !== null) {
            DB::table('academy_subscriptions')->where('id', $legacy->id)->update($mirror);
        } else {
            DB::table('academy_subscriptions')->insert($mirror + [
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'created_at' => now(),
            ]);
        }
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** The live sub for a module, created plan-less/non-trial when missing. */
    public function ensure(string $academyId, string $module): object
    {
        $this->assertModule($module);
        $existing = $this->current($academyId, $module);
        if ($existing !== null) {
            return $existing;
        }

        // An academy the module engine has never touched (pre-backfill / test-inserted) must be
        // derived from its legacy single-plan state FIRST — creating a bare plan-less sub here
        // would flip the entitlement resolver onto the module path with no plan and silently wipe
        // the academy's capabilities. Same lazy-backfill idea as AcademyBilling::ensureSubscription.
        // Only when there IS legacy state to preserve, though: a fresh lightweight client (e.g. a
        // WhatsApp-only external client, M-CLI-2 — no plan, no legacy subscription) must get ONLY
        // the requested module, not a manufactured plan-less MANAGEMENT sub.
        if ($this->all($academyId)->isEmpty() && $this->hasLegacyBillingState($academyId)) {
            \App\Support\ModuleSubscriptionBackfill::runForAcademy($academyId);
            $existing = $this->current($academyId, $module);
            if ($existing !== null) {
                return $existing;
            }
        }

        $currency = (string) (DB::table('academies')->where('id', $academyId)->value('default_currency') ?? 'EGP');
        $id = (string) Str::uuid();
        DB::table('module_subscriptions')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'module' => $module,
            'status' => 'ACTIVE',
            'is_trial' => false,
            'billing_interval' => (string) config('billing.default_interval', 'MONTHLY'),
            'base_price_minor' => 0,
            'addons_price_minor' => 0,
            'total_cost_minor' => 0,
            'currency' => $currency,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('module_subscriptions')->where('id', $id)->first();
    }

    /**
     * Restore a client's access after an upward lifecycle action (enable / trial / activate): the
     * academy status becomes the derived label — TRIAL when every ACTIVE module is a trial, else
     * ACTIVE — and any suspension clears, matching the legacy extendTrial/activate behaviour.
     */
    private function restoreAccess(string $academyId): void
    {
        $active = $this->all($academyId)->where('status', 'ACTIVE');
        if ($active->isEmpty()) {
            return;
        }

        $label = $active->every(fn (object $s): bool => (bool) $s->is_trial) ? 'TRIAL' : 'ACTIVE';

        DB::table('academies')->where('id', $academyId)->update([
            'status' => $label,
            'suspended_at' => null,
            'suspended_reason' => null,
            'updated_at' => now(),
        ]);
    }

    /** Suspend the client when NO active module remains (scoped suspension's outer edge). */
    private function suspendIfNothingActive(string $academyId, string $reason): bool
    {
        $anyActive = $this->all($academyId)->contains(fn (object $s): bool => $s->status === 'ACTIVE');
        if ($anyActive) {
            return false;
        }

        DB::table('academies')->where('id', $academyId)->update([
            'status' => 'SUSPENDED',
            'suspended_at' => now(),
            'suspended_reason' => $reason,
            'updated_at' => now(),
        ]);

        return true;
    }

    /** Does this academy carry pre-module billing state (a plan, a video grant, or a legacy sub)? */
    private function hasLegacyBillingState(string $academyId): bool
    {
        $academy = DB::table('academies')->where('id', $academyId)
            ->first(['plan_id', 'video_access', 'video_plan_id', 'video_overrides']);
        if ($academy !== null
            && ($academy->plan_id !== null || $academy->video_access !== null
                || $academy->video_plan_id !== null || $academy->video_overrides !== null)) {
            return true;
        }

        return DB::table('academy_subscriptions')
            ->where('academy_id', $academyId)
            ->where('status', '<>', 'ENDED')
            ->exists();
    }

    private function periodEnd(Carbon $start, string $interval): Carbon
    {
        return $interval === 'YEARLY' ? $start->copy()->addYear() : $start->copy()->addMonth();
    }

    private function assertModule(string $module): void
    {
        if (! in_array($module, self::MODULES, true)) {
            throw ValidationException::withMessages(['module' => ["Unknown module: {$module}."]]);
        }
    }

    /** A sub's plan must belong to the sub's module (01-DATA-MODEL §6, app-layer constraint). */
    private function assertPlanBelongs(string $planId, string $module): void
    {
        $planModule = DB::table('plans')->where('id', $planId)->value('module');
        if ($planModule === null) {
            throw ValidationException::withMessages(['plan_id' => ['Plan not found.']]);
        }
        if ((string) $planModule !== $module) {
            throw ValidationException::withMessages([
                'plan_id' => ["Plan belongs to the {$planModule} module, not {$module}."],
            ]);
        }
    }

    private function hasOverrides(object $sub): bool
    {
        return $this->decodeOverrides($sub->overrides) !== [];
    }

    /** @return array<string,mixed> */
    private function decodeOverrides(mixed $raw): array
    {
        $decoded = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);

        return is_array($decoded) ? $decoded : [];
    }

    /** @return list<string> */
    private function capabilitiesOf(mixed $features): array
    {
        $decoded = is_string($features) ? json_decode($features, true) : (is_array($features) ? $features : null);

        return is_array($decoded) && isset($decoded['capabilities']) && is_array($decoded['capabilities'])
            ? array_map('strval', $decoded['capabilities'])
            : [];
    }
}
