<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Phase 1 (docs/superadmin-modules) — derive `module_subscriptions` rows from the CURRENT
 * single-plan model, WITHOUT changing entitlement resolution (the old resolver still runs; these
 * rows are written but not yet read). Idempotent and re-runnable.
 *
 * Derivation (mirrors what App\Support\Entitlement resolves today so Phase 2 can prove parity):
 *
 *  1. PRIMARY sub — one per academy, cloned from its live `academy_subscriptions` row (lifecycle,
 *     plan, prices, currency). module = VIDEO when the academy's plan is a VIDEO-module plan
 *     (the MEET "video-only" plan), else MANAGEMENT. A MEET academy folds its `academies.video_*`
 *     columns into this sub's `overrides`.
 *  2. EXTRA VIDEO sub — only for a NON-MEET academy that carries a per-academy video OVERRIDE
 *     (any of `video_access` / `video_plan_id` / `video_overrides` set). This is the container the
 *     override moves into (out of the `academies` columns); video granted purely by an add-on stays
 *     on the add-on path in Entitlement, so it needs no VIDEO sub. price 0 (billing attribution is
 *     Phase 2 — these rows carry ENTITLEMENT, not yet money).
 *  3. WHATSAPP sub — on the internal `WA_BUNDLED` plan for every academy whose plan bundles
 *     `whatsapp.automation` today (D6), so WhatsApp keeps working once it becomes its own module.
 *
 * NO FORCE-RLS DDL. Both entry points work by setting the tenant context and running plain INSERTs
 * that RLS admits (a bulk cross-tenant read/write with the `alter table … no force` dance is fragile
 * — `MigrationsRollbackTest` re-runs the migration inside a transaction, where the DDL breaks
 * savepoint nesting and poisons the connection with "current transaction is aborted", M-PROC-2).
 *
 *  - run() — every academy: read the id list under a SUPER_ADMIN context (`academies_select` admits
 *    a super admin), then backfill each in its own context. For the parity MIGRATION + tests.
 *  - runForAcademy() — ONE academy; the caller must already be in that academy's tenant context (or
 *    SUPER_ADMIN) so RLS admits the reads and the tenant `with check` admits the writes.
 *
 * The whatsapp-capability test uses `@>` (jsonb containment), not `?` (contains-element), so every
 * statement is plainly parameterised.
 */
final class ModuleSubscriptionBackfill
{
    /** Backfill every academy — sets a SUPER_ADMIN context to enumerate, then each academy's own. */
    public static function run(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        $ids = DB::table('academies')->pluck('id')->all();

        foreach ($ids as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);
            self::runForAcademy((string) $id);
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    /** Backfill a SINGLE academy in-context (no DDL) — safe inside a seeder/test transaction. */
    public static function runForAcademy(string $academyId): void
    {
        DB::statement(self::primaryInsertSql(' and a.id = ?'), [$academyId]);
        DB::statement(self::videoInsertSql(' and a.id = ?'), [$academyId]);
        DB::statement(self::whatsappInsertSql(' and a.id = ?'), [$academyId]);
    }

    /**
     * Reconcile ONE academy's module subs to its CURRENT single-plan state — the write-path keeper
     * (Phase 2b). Called by academy create / setPlan / video setAccess (each already inside the
     * academy's tenant context) so `Entitlement::resolveFromModules` reads current state after a
     * change. Upserts the subs that should exist and ENDs those that shouldn't (per-module, no DDL).
     * Unlike runForAcademy (insert-if-missing), this UPDATES an existing live sub in place, so a plan
     * or video change is reflected, and a module dropped by the change is ended.
     */
    public static function reconcile(string $academyId): void
    {
        $a = DB::table('academies')->where('id', $academyId)->first([
            'plan_id', 'video_access', 'video_trial_ends_at', 'video_plan_id', 'video_overrides', 'default_currency',
        ]);
        if ($a === null) {
            return;
        }

        $plan = $a->plan_id !== null
            ? DB::table('plans')->where('id', $a->plan_id)->first(['module', 'currency', 'features'])
            : null;
        $planModule = $plan->module ?? 'MANAGEMENT';
        $currency = $plan->currency ?? $a->default_currency ?? 'EGP';
        $videoIsPrimary = $planModule === 'VIDEO';
        $hasVideoOverride = $a->video_access !== null || $a->video_plan_id !== null || $a->video_overrides !== null;

        // MANAGEMENT — the primary sub unless the plan is a VIDEO-module (MEET) plan.
        self::upsertOrEnd($academyId, 'MANAGEMENT', ! $videoIsPrimary, $a->plan_id, null, $currency);

        // VIDEO — primary for a MEET client, else an override container.
        $videoTarget = $videoIsPrimary || $hasVideoOverride;
        self::upsertOrEnd(
            $academyId,
            'VIDEO',
            $videoTarget,
            $videoIsPrimary ? $a->plan_id : $a->video_plan_id,
            $videoTarget ? self::foldVideoOverrides($a) : null,
            $currency,
        );

        // WHATSAPP — on WA_BUNDLED whenever the plan bundles whatsapp.automation.
        $whatsappTarget = in_array('whatsapp.automation', self::capabilitiesOf($plan->features ?? null), true);
        self::upsertOrEnd(
            $academyId,
            'WHATSAPP',
            $whatsappTarget,
            $whatsappTarget ? DB::table('plans')->where('code', 'WA_BUNDLED')->value('id') : null,
            null,
            $currency,
        );
    }

    /** Upsert the live sub for a module (create/update) when it should exist, else END it. */
    private static function upsertOrEnd(string $academyId, string $module, bool $should, ?string $planId, ?array $overrides, string $currency): void
    {
        $live = DB::table('module_subscriptions')
            ->where('academy_id', $academyId)->where('module', $module)->where('status', '<>', 'ENDED')
            ->first(['id']);

        if (! $should) {
            if ($live !== null) {
                DB::table('module_subscriptions')->where('id', $live->id)
                    ->update(['status' => 'ENDED', 'updated_at' => now()]);
            }

            return;
        }

        $payload = [
            'plan_id' => $planId,
            'overrides' => $overrides !== null ? json_encode($overrides) : null,
            'updated_at' => now(),
        ];

        if ($live !== null) {
            DB::table('module_subscriptions')->where('id', $live->id)->update($payload);

            return;
        }

        DB::table('module_subscriptions')->insert(array_merge($payload, [
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'module' => $module,
            'status' => 'ACTIVE',
            'is_trial' => false,
            'billing_interval' => 'MONTHLY',
            'base_price_minor' => 0,
            'addons_price_minor' => 0,
            'total_cost_minor' => 0,
            'currency' => $currency,
            'created_at' => now(),
        ]));
    }

    /** Fold the academy's `video_*` columns into the VIDEO sub `overrides` shape (null when empty). */
    private static function foldVideoOverrides(object $a): ?array
    {
        $limits = null;
        if ($a->video_overrides !== null) {
            $decoded = is_string($a->video_overrides) ? json_decode($a->video_overrides, true) : $a->video_overrides;
            $limits = is_array($decoded) ? ($decoded['limits'] ?? null) : null;
        }

        $overrides = array_filter([
            'access' => $a->video_access,
            'trialEnd' => $a->video_trial_ends_at,
            'tierPlanId' => $a->video_plan_id,
            'limits' => $limits,
        ], static fn ($v): bool => $v !== null);

        return $overrides === [] ? null : $overrides;
    }

    /** The capability list from a plan.features jsonb (empty when absent/blank). */
    private static function capabilitiesOf(mixed $features): array
    {
        $decoded = is_string($features) ? json_decode($features, true) : (is_array($features) ? $features : null);

        return is_array($decoded) && isset($decoded['capabilities']) && is_array($decoded['capabilities'])
            ? array_map('strval', $decoded['capabilities'])
            : [];
    }

    /** (1) PRIMARY sub: clone the live academy_subscriptions row (MANAGEMENT, or VIDEO for MEET). */
    private static function primaryInsertSql(string $filter): string
    {
        return <<<SQL
            insert into module_subscriptions
              (id, academy_id, module, plan_id, status, is_trial, trial_start, trial_end,
               activated_at, current_period_start, current_period_end, billing_interval,
               base_price_minor, addons_price_minor, total_cost_minor, currency, overrides,
               canceled_at, created_at, updated_at)
            select
              uuid_generate_v7(), a.id,
              case when p.module = 'VIDEO' then 'VIDEO' else 'MANAGEMENT' end,
              a.plan_id,
              coalesce(s.status, 'ACTIVE'::subscription_status),
              coalesce(s.is_trial, a.status = 'TRIAL'),
              s.trial_start, s.trial_end, s.activated_at, s.current_period_start, s.current_period_end,
              coalesce(s.billing_interval, 'MONTHLY'),
              coalesce(s.base_price_minor, 0), coalesce(s.addons_price_minor, 0),
              coalesce(s.total_cost_minor, 0),
              coalesce(s.currency, p.currency, a.default_currency),
              case when p.module = 'VIDEO'
                   then nullif(jsonb_strip_nulls(jsonb_build_object(
                          'access', a.video_access,
                          'trialEnd', a.video_trial_ends_at,
                          'tierPlanId', a.video_plan_id,
                          'limits', a.video_overrides -> 'limits')), '{}'::jsonb)
                   else null end,
              s.canceled_at, now(), now()
            from academies a
            left join plans p on p.id = a.plan_id
            left join lateral (
              select * from academy_subscriptions asub
              where asub.academy_id = a.id and asub.status <> 'ENDED'
              order by asub.created_at desc limit 1
            ) s on true
            where not exists (
              select 1 from module_subscriptions m
              where m.academy_id = a.id
                and m.module = case when p.module = 'VIDEO' then 'VIDEO' else 'MANAGEMENT' end
                and m.status <> 'ENDED'
            ){$filter};
        SQL;
    }

    /** (2) EXTRA VIDEO sub: a per-academy video override on a non-MEET academy. */
    private static function videoInsertSql(string $filter): string
    {
        return <<<SQL
            insert into module_subscriptions
              (id, academy_id, module, plan_id, status, is_trial, billing_interval,
               base_price_minor, addons_price_minor, total_cost_minor, currency, overrides,
               created_at, updated_at)
            select
              uuid_generate_v7(), a.id, 'VIDEO', a.video_plan_id, 'ACTIVE'::subscription_status,
              false, 'MONTHLY', 0, 0, 0, coalesce(a.default_currency, 'EGP'),
              nullif(jsonb_strip_nulls(jsonb_build_object(
                'access', a.video_access,
                'trialEnd', a.video_trial_ends_at,
                'tierPlanId', a.video_plan_id,
                'limits', a.video_overrides -> 'limits')), '{}'::jsonb),
              now(), now()
            from academies a
            left join plans p on p.id = a.plan_id
            where coalesce(p.module, 'MANAGEMENT') <> 'VIDEO'
              and (a.video_access is not null or a.video_plan_id is not null or a.video_overrides is not null)
              and not exists (
                select 1 from module_subscriptions m
                where m.academy_id = a.id and m.module = 'VIDEO' and m.status <> 'ENDED'
              ){$filter};
        SQL;
    }

    /** (3) WHATSAPP sub: on WA_BUNDLED for academies whose plan bundles whatsapp.automation. */
    private static function whatsappInsertSql(string $filter): string
    {
        return <<<SQL
            insert into module_subscriptions
              (id, academy_id, module, plan_id, status, is_trial, billing_interval,
               base_price_minor, addons_price_minor, total_cost_minor, currency, created_at, updated_at)
            select
              uuid_generate_v7(), a.id, 'WHATSAPP', wb.id, 'ACTIVE'::subscription_status,
              false, 'MONTHLY', 0, 0, 0, coalesce(a.default_currency, 'EGP'), now(), now()
            from academies a
            join plans p on p.id = a.plan_id
            cross join (select id from plans where code = 'WA_BUNDLED' limit 1) wb
            where p.features -> 'capabilities' @> '"whatsapp.automation"'::jsonb
              and not exists (
                select 1 from module_subscriptions m
                where m.academy_id = a.id and m.module = 'WHATSAPP' and m.status <> 'ENDED'
              ){$filter};
        SQL;
    }
}
