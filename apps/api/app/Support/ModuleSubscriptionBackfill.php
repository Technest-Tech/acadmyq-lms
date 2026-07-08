<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

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
