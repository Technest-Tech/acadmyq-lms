<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Platform → Academy bills. These are the invoices the PLATFORM issues to an academy for its SaaS
 * subscription (distinct from the per-student `invoices` table). One bill per subscription period;
 * an academy pays it via the public pay page (Phase 3, InstaPay/Vodafone Cash + screenshot) and a
 * Super Admin marks it paid.
 *
 * Tenant-scoped RLS (standard `tenant_isolation`): the academy owner reads their OWN bills for the
 * dashboard/pay flow; the Super Admin manages them inside the academy's context. Public, no-auth
 * access goes through a SECURITY DEFINER function by token (added in the Phase 3 migration), never
 * a policy. Management is gated at the API layer by `academy_billing.manage` (Super Admin only).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create type platform_invoice_status as enum ('OPEN', 'PAID', 'OVERDUE', 'VOID');

            create table academy_invoices (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id) on delete cascade,
              subscription_id   uuid references academy_subscriptions(id),
              period_start      date not null,
              period_end        date not null,
              status            platform_invoice_status not null default 'OPEN',
              currency          char(3) not null,
              subtotal_minor    bigint not null default 0,
              total_minor       bigint not null default 0,
              amount_paid_minor bigint not null default 0,
              due_date          date not null,
              issued_at         timestamptz not null default now(),
              paid_at           timestamptz,
              payment_method    text,
              payment_reason    text,
              public_token      text not null unique,
              sent_at           timestamptz,
              sent_channel      text,
              reminder_count    smallint not null default 0,
              created_at        timestamptz not null default now(),
              updated_at        timestamptz not null default now()
            );

            -- One bill per academy per period — makes scheduled generation idempotent.
            create unique index academy_invoices_period_uidx
              on academy_invoices (academy_id, period_start, period_end);
            create index academy_invoices_status_idx on academy_invoices (academy_id, status);
            create index academy_invoices_due_idx on academy_invoices (status, due_date);

            alter table academy_invoices enable row level security;
            alter table academy_invoices force row level security;
            create policy tenant_isolation on academy_invoices
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on academy_invoices;
            drop table if exists academy_invoices;
            drop type if exists platform_invoice_status;
        SQL);
    }
};
