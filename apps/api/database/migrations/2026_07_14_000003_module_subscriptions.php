<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 1 (docs/superadmin-modules/01-DATA-MODEL §2.2) — the core of the modular platform:
 * `module_subscriptions` lets ONE shared client (an `academies` row) hold at most one LIVE
 * subscription PER MODULE (MANAGEMENT | WHATSAPP | VIDEO), each with its own plan, lifecycle,
 * price, and (for video) `overrides`. It generalizes `academy_subscriptions` — same shape plus
 * `module` and `overrides` — so the billing engine port (Phase 2) is mechanical.
 *
 * `overrides` (jsonb) absorbs the per-academy video axis (access / trial / tier / limits) that lives
 * on the `academies` columns today; those columns are dropped in Phase 6 once nothing reads them.
 *
 * Tenant-scoped RLS, identical policy to `academy_subscriptions` (owner reads own module subs;
 * Super Admin writes in the academy's context). Reuses the `subscription_status` enum.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table module_subscriptions (
              id                   uuid primary key default uuid_generate_v7(),
              academy_id           uuid not null references academies(id) on delete cascade,
              module               text not null,
              plan_id              uuid references plans(id),
              status               subscription_status not null default 'ACTIVE',
              is_trial             boolean not null default false,
              trial_start          timestamptz,
              trial_end            timestamptz,
              activated_at         timestamptz,
              current_period_start timestamptz,
              current_period_end   timestamptz,
              billing_interval     text not null default 'MONTHLY',
              base_price_minor     bigint not null default 0,
              addons_price_minor   bigint not null default 0,
              total_cost_minor     bigint not null default 0,
              currency             char(3) not null,
              overrides            jsonb,
              canceled_at          timestamptz,
              created_at           timestamptz not null default now(),
              updated_at           timestamptz not null default now(),
              constraint module_subscriptions_module_chk
                check (module in ('MANAGEMENT', 'WHATSAPP', 'VIDEO')),
              constraint module_subscriptions_interval_chk
                check (billing_interval in ('MONTHLY', 'YEARLY'))
            );

            -- One live subscription per (academy, module); ENDED rows are history (M-SUB-2).
            create unique index module_subscriptions_one_live_uidx
              on module_subscriptions (academy_id, module) where status <> 'ENDED';
            create index module_subscriptions_academy_idx on module_subscriptions (academy_id);
            create index module_subscriptions_module_status_idx on module_subscriptions (module, status);
            create index module_subscriptions_trial_end_idx
              on module_subscriptions (trial_end) where is_trial = true;
            create index module_subscriptions_period_end_idx
              on module_subscriptions (current_period_end);

            -- Standard tenant isolation (owner reads own; Super Admin writes in academy context).
            alter table module_subscriptions enable row level security;
            alter table module_subscriptions force row level security;
            create policy tenant_isolation on module_subscriptions
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on module_subscriptions;
            drop table if exists module_subscriptions;
        SQL);
    }
};
