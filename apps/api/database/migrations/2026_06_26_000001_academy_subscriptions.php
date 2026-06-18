<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The academy's subscription to the SaaS platform (Platform↔Academy billing). Distinct from the
 * per-student `subscriptions` table — this models the academy's OWN plan lifecycle: free-trial
 * window, activation/period dates, and the snapshot total cost (plan price + active add-ons).
 *
 * One LIVE row per academy (partial unique index where status <> 'ENDED'); renewals/re-trials can
 * append history. Reuses the existing `subscription_status` enum (ACTIVE|PAUSED|ENDED) with
 * `is_trial` distinguishing a trial from a paid subscription.
 *
 * Tenant-scoped RLS (standard `tenant_isolation`, identical to academy_addons): the academy owner
 * reads their OWN subscription for the dashboard, and the Super Admin manages it inside the target
 * academy's context (AcademyController::inAcademyContext). Management is gated at the API layer by
 * the Super-Admin-only `academy_billing.manage` capability.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table academy_subscriptions (
              id                   uuid primary key default uuid_generate_v7(),
              academy_id           uuid not null references academies(id) on delete cascade,
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
              canceled_at          timestamptz,
              created_at           timestamptz not null default now(),
              updated_at           timestamptz not null default now(),
              constraint academy_subscriptions_interval_chk
                check (billing_interval in ('MONTHLY', 'YEARLY'))
            );

            -- One live subscription per academy; ENDED rows are history and don't collide.
            create unique index academy_subscriptions_one_live_uidx
              on academy_subscriptions (academy_id) where status <> 'ENDED';
            create index academy_subscriptions_academy_idx on academy_subscriptions (academy_id);
            create index academy_subscriptions_trial_end_idx
              on academy_subscriptions (trial_end) where is_trial = true;
            create index academy_subscriptions_period_end_idx
              on academy_subscriptions (current_period_end);

            -- Standard tenant isolation (owner reads own; Super Admin writes in academy context).
            alter table academy_subscriptions enable row level security;
            alter table academy_subscriptions force row level security;
            create policy tenant_isolation on academy_subscriptions
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on academy_subscriptions;
            drop table if exists academy_subscriptions;
        SQL);
    }
};
