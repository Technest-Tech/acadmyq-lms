<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Finance ledger — the platform owner's OWN income book.
 *
 * This is deliberately an island. Nothing here references `academies`, `module_subscriptions`,
 * `academy_invoices` or any other billing table, and nothing in those tables will ever read
 * these. The owner records what a client actually agreed to pay (a deal), when the money is
 * expected (installments), and what actually arrived (payments) — for a course site, a copy of
 * the management system, a custom job, hosting, anything. A "client" here is a name in the
 * owner's book, not a tenant; two clients may share a name with an academy and that is fine.
 *
 * Shape: client ─< deal ─< installment, and deal ─< payment. A payment is money against a DEAL,
 * not against one installment: coverage is derived by a waterfall (oldest due first), which is
 * what makes "he paid 3,000 of the 5,000 second installment" and "he paid three months up front"
 * both plain inserts rather than allocation puzzles. Subscriptions are the same shape with one
 * open installment at a time; settling it rolls the next cycle in (see FinanceLedger).
 *
 * PLATFORM-scoped, Super-Admin-only, and the database says so itself: every table forces RLS
 * with `app.is_super_admin()` on every command, so no tenant context — entered or not — can
 * read a single row.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table finance_clients (
              id          uuid primary key default uuid_generate_v7(),
              name        text not null,
              phone       text,
              email       text,
              notes       text,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );
            -- One book entry per client name, case-insensitively: "Azhary" and "azhary" are the
            -- same person and would otherwise split his totals in two.
            create unique index finance_clients_name_uidx on finance_clients (lower(name));

            create table finance_deals (
              id           uuid primary key default uuid_generate_v7(),
              client_id    uuid not null references finance_clients (id) on delete restrict,
              -- What was sold, in the owner's words ("Course site for Azhary", "LMS yearly").
              title        text not null,
              -- Coarse catalog for the statistics: which product line the money belongs to.
              service      text not null,
              -- ONE_TIME: a sale (optionally split into installments). SUBSCRIPTION: recurring.
              kind         text not null,
              -- Billing cycle of a subscription; null for a one-time sale.
              billing_interval text,
              -- ONE_TIME: the agreed total. SUBSCRIPTION: the price of one cycle.
              amount_minor bigint not null,
              currency     text not null,
              started_on   date not null,
              status       text not null default 'ACTIVE',
              notes        text,
              created_at   timestamptz not null default now(),
              updated_at   timestamptz not null default now(),
              constraint finance_deals_service_chk
                check (service in ('COURSE_SITE', 'MANAGEMENT_SYSTEM', 'VIDEO_PLATFORM', 'WHATSAPP_SERVICE', 'CUSTOM_WORK', 'HOSTING', 'OTHER')),
              constraint finance_deals_kind_chk check (kind in ('ONE_TIME', 'SUBSCRIPTION')),
              constraint finance_deals_interval_chk
                check (billing_interval is null or billing_interval in ('MONTHLY', 'QUARTERLY', 'YEARLY')),
              -- A subscription always has a cycle; a one-time sale never does.
              constraint finance_deals_kind_interval_chk
                check ((kind = 'SUBSCRIPTION') = (billing_interval is not null)),
              constraint finance_deals_status_chk check (status in ('ACTIVE', 'COMPLETED', 'CANCELLED')),
              constraint finance_deals_amount_chk check (amount_minor >= 0),
              constraint finance_deals_currency_chk check (currency ~ '^[A-Z]{3}$')
            );
            create index finance_deals_client_idx on finance_deals (client_id);
            create index finance_deals_status_idx on finance_deals (status, started_on desc);

            create table finance_installments (
              id           uuid primary key default uuid_generate_v7(),
              deal_id      uuid not null references finance_deals (id) on delete cascade,
              -- Position in the schedule; the waterfall orders by (due_on, seq).
              seq          integer not null,
              due_on       date not null,
              amount_minor bigint not null,
              note         text,
              created_at   timestamptz not null default now(),
              constraint finance_installments_amount_chk check (amount_minor > 0),
              constraint finance_installments_seq_uidx unique (deal_id, seq)
            );
            create index finance_installments_due_idx on finance_installments (due_on);

            create table finance_payments (
              id           uuid primary key default uuid_generate_v7(),
              deal_id      uuid not null references finance_deals (id) on delete cascade,
              paid_on      date not null,
              amount_minor bigint not null,
              method       text not null,
              -- Transfer number, receipt, InstaPay reference — whatever proves the money moved.
              reference    text,
              note         text,
              created_at   timestamptz not null default now(),
              constraint finance_payments_amount_chk check (amount_minor > 0),
              constraint finance_payments_method_chk
                check (method in ('CASH', 'BANK_TRANSFER', 'INSTAPAY', 'VODAFONE_CASH', 'PAYPAL', 'CARD', 'OTHER'))
            );
            create index finance_payments_deal_idx on finance_payments (deal_id);
            create index finance_payments_paid_on_idx on finance_payments (paid_on desc);

            alter table finance_clients      enable row level security;
            alter table finance_clients      force row level security;
            alter table finance_deals        enable row level security;
            alter table finance_deals        force row level security;
            alter table finance_installments enable row level security;
            alter table finance_installments force row level security;
            alter table finance_payments     enable row level security;
            alter table finance_payments     force row level security;

            create policy finance_clients_owner on finance_clients
              for all using (app.is_super_admin()) with check (app.is_super_admin());
            create policy finance_deals_owner on finance_deals
              for all using (app.is_super_admin()) with check (app.is_super_admin());
            create policy finance_installments_owner on finance_installments
              for all using (app.is_super_admin()) with check (app.is_super_admin());
            create policy finance_payments_owner on finance_payments
              for all using (app.is_super_admin()) with check (app.is_super_admin());

            comment on table finance_clients is
              'Platform owner''s own income book: the people/companies that pay the owner. NOT tenants — no link to academies by design.';
            comment on table finance_deals is
              'Platform owner''s own income book: something sold (one-time, optionally in installments) or a recurring subscription.';
            comment on table finance_installments is
              'Expected money per deal; coverage is derived from payments by an oldest-first waterfall (FinanceLedger).';
            comment on table finance_payments is
              'Money actually received against a deal. Not allocated to an installment — the waterfall does that.';
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists finance_payments;
            drop table if exists finance_installments;
            drop table if exists finance_deals;
            drop table if exists finance_clients;
        SQL);
    }
};
