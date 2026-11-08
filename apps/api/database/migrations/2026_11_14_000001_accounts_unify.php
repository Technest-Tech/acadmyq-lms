<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Accounts — the owner's income book becomes THE money book of the platform (Ahmed, 2026-11-08:
 * "billing, subscriptions and finance are one thing").
 *
 * Until now the platform charged its clients through `academy_invoices` (one bill per module
 * period, rolled nightly) while the owner kept a separate cash book (`finance_*`) that knew nothing
 * about academies. The same client lived twice and an approved payment proof never reached the
 * book. From here on:
 *
 *  - a book client may BE a platform client (`finance_clients.linked_academy_id`, one account per
 *    academy). An account without one is a client off our servers — someone who bought the whole
 *    system, a course site, a custom job.
 *  - `plan` names the agreement the owner picked (monthly, every 3 or 6 months, yearly, one payment
 *    plus yearly support and server, outright purchase). The deals underneath carry the money; the
 *    plan is how the agreement reads in a list.
 *  - subscriptions may run every six months (`SEMI_ANNUAL`), and a cycle may record the price it was
 *    discounted from (`list_amount_minor`) so "yearly, 15% off" is a fact, not a note.
 *  - `SUPPORT` joins the services: yearly support for a client hosting the system themselves.
 *  - a client pays from one link (`pay_token`, the page at /a/{token}) and uploads a transfer proof
 *    (`finance_payment_submissions`); approving it records a payment in the same book a hand-typed
 *    payment lands in.
 *
 * The public page and the academy's own dashboard read through SECURITY DEFINER functions owned by
 * the bypass role, exactly like the bill page they replace — the tables themselves stay Super-Admin
 * only (FORCE RLS on app.is_super_admin()).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table finance_clients
              -- Deliberately NOT named academy_id: tenant tooling (app.purge_academy, the RLS
              -- introspection gate) treats every academy_id column as a tenant row, and this is a
              -- platform row. Purging the academy unlinks its account (set null) and keeps the money.
              add column linked_academy_id uuid references academies (id) on delete set null,
              add column plan       text,
              add column pay_token  text,
              add constraint finance_clients_plan_chk
                check (plan is null or plan in ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY', 'ONE_TIME_SUPPORT', 'OUTRIGHT', 'CUSTOM'));
            -- One account per platform client; a purged academy leaves its money history behind.
            create unique index finance_clients_academy_uidx on finance_clients (linked_academy_id) where linked_academy_id is not null;
            create unique index finance_clients_pay_token_uidx on finance_clients (pay_token) where pay_token is not null;

            alter table finance_deals drop constraint finance_deals_interval_chk;
            alter table finance_deals add constraint finance_deals_interval_chk
              check (billing_interval is null or billing_interval in ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY'));
            alter table finance_deals drop constraint finance_deals_service_chk;
            alter table finance_deals add constraint finance_deals_service_chk
              check (service in ('COURSE_SITE', 'MANAGEMENT_SYSTEM', 'VIDEO_PLATFORM', 'WHATSAPP_SERVICE', 'CUSTOM_WORK', 'HOSTING', 'SUPPORT', 'OTHER'));
            -- The price of one cycle BEFORE the discount ("12 × 1,000, sold at 10,200"). Null = no discount.
            alter table finance_deals add column list_amount_minor bigint;
            alter table finance_deals add constraint finance_deals_list_amount_chk
              check (list_amount_minor is null or list_amount_minor > 0);
            -- A subscription that stops rolling: no cycle starting on or after this day is owed.
            -- Cycles before it are still owed, so a client who switches agreement (or leaves)
            -- keeps what is due until it is paid, and the deal completes itself then.
            alter table finance_deals add column ends_on date;

            -- What the reminder sweep already sent, so a client hears about one due once per step.
            create table finance_reminder_log (
              id         uuid primary key default uuid_generate_v7(),
              client_id  uuid references finance_clients (id) on delete cascade,
              key        text not null,
              status     text not null,
              created_at timestamptz not null default now(),
              constraint finance_reminder_log_status_chk check (status in ('SENT', 'FAILED'))
            );
            create unique index finance_reminder_log_sent_uidx on finance_reminder_log (key) where status = 'SENT';
            alter table finance_reminder_log enable row level security;
            alter table finance_reminder_log force row level security;
            create policy finance_reminder_log_owner on finance_reminder_log
              for all using (app.is_super_admin()) with check (app.is_super_admin());

            create table finance_payment_submissions (
              id              uuid primary key default uuid_generate_v7(),
              client_id       uuid not null references finance_clients (id) on delete cascade,
              method          text not null,
              -- What the payer says they sent; the reviewer confirms (or corrects) it on approval.
              amount_minor    bigint,
              currency        text not null,
              note            text,
              screenshot_path text not null,
              status          text not null default 'PENDING',
              reviewed_at     timestamptz,
              created_at      timestamptz not null default now(),
              constraint finance_payment_submissions_status_chk check (status in ('PENDING', 'APPROVED', 'REJECTED')),
              constraint finance_payment_submissions_amount_chk check (amount_minor is null or amount_minor >= 0)
            );
            create index finance_payment_submissions_client_idx on finance_payment_submissions (client_id, created_at desc);
            create index finance_payment_submissions_pending_idx on finance_payment_submissions (status) where status = 'PENDING';

            alter table finance_payment_submissions enable row level security;
            alter table finance_payment_submissions force row level security;
            create policy finance_payment_submissions_owner on finance_payment_submissions
              for all using (app.is_super_admin()) with check (app.is_super_admin());

            -- Which proof a payment came from (null = typed by hand).
            alter table finance_payments
              add column submission_id uuid references finance_payment_submissions (id) on delete set null;

            comment on column finance_clients.linked_academy_id is
              'The platform client this account belongs to; null for a client off our servers.';
            comment on column finance_clients.plan is
              'The agreement the owner picked; the deals carry the money.';
        SQL);

        // ── What one account owes right now, as JSON (shared by the public page + the dashboard) ──
        DB::unprepared(<<<'SQL'
            create or replace function app.finance_account_dues(p_client_id uuid)
            returns jsonb
            language sql stable security definer
            set search_path = public, pg_catalog
            as $$
              with inst as (
                select i.id, i.deal_id, i.due_on, i.amount_minor,
                       sum(i.amount_minor) over (
                         partition by i.deal_id order by i.due_on, i.seq, i.id
                         rows between unbounded preceding and current row
                       ) as cum_minor
                from finance_installments i
                join finance_deals d on d.id = i.deal_id
                where d.client_id = p_client_id and d.status = 'ACTIVE'
              ),
              pay as (
                select p.deal_id, sum(p.amount_minor)::bigint as paid_minor
                from finance_payments p
                join finance_deals d on d.id = p.deal_id
                where d.client_id = p_client_id
                group by p.deal_id
              ),
              dues as (
                select inst.id, inst.deal_id, inst.due_on,
                       greatest(0, least(inst.amount_minor, inst.cum_minor - coalesce(pay.paid_minor, 0)))::bigint as remaining_minor
                from inst left join pay on pay.deal_id = inst.deal_id
              ),
              open_dues as (
                select dues.*, d.title, d.currency
                from dues join finance_deals d on d.id = dues.deal_id
                where dues.remaining_minor > 0
              )
              select jsonb_build_object(
                'dues', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', o.id, 'title', o.title, 'due_on', o.due_on,
                    'remaining_minor', o.remaining_minor, 'currency', o.currency,
                    'overdue', o.due_on < current_date
                  ) order by o.due_on)
                  from open_dues o
                ), '[]'::jsonb),
                -- What to pay now: everything already due plus anything falling due within a week.
                'due_now', coalesce((
                  select jsonb_agg(jsonb_build_object('currency', x.currency, 'amount_minor', x.s) order by x.currency)
                  from (
                    select currency, sum(remaining_minor)::bigint as s
                    from open_dues where due_on <= current_date + 7
                    group by currency
                  ) x
                ), '[]'::jsonb),
                'next_due_on', (select min(due_on) from open_dues),
                'overdue', exists (select 1 from open_dues where due_on < current_date),
                'pending_proof', exists (
                  select 1 from finance_payment_submissions s
                  where s.client_id = p_client_id and s.status = 'PENDING'
                )
              )
            $$;
        SQL);

        // ── The public pay page by token ──
        // An account token first; an old bill link (academy_invoices.public_token, sent before the
        // book took over) still opens its academy's account, so no link a client holds goes dead.
        DB::unprepared(<<<'SQL'
            create or replace function app.finance_client_by_pay_token(p_token text)
            returns uuid
            language plpgsql stable security definer
            set search_path = public, pg_catalog
            as $$
            declare v_id uuid;
            begin
              if p_token is null or p_token = '' then
                return null;
              end if;
              select id into v_id from finance_clients where pay_token = p_token limit 1;
              if v_id is not null then
                return v_id;
              end if;
              select fc.id into v_id
              from academy_invoices ai
              join finance_clients fc on fc.linked_academy_id = ai.academy_id
              where ai.public_token = p_token
              limit 1;
              return v_id;
            end;
            $$;

            create or replace function app.public_account_by_token(p_token text)
            returns json
            language plpgsql stable security definer
            set search_path = public, pg_catalog
            as $$
            declare
              v_client  record;
              v_methods jsonb;
              v_id      uuid;
            begin
              v_id := app.finance_client_by_pay_token(p_token);
              if v_id is null then
                return null;
              end if;

              select c.id, c.name, a.name as academy_name
              into v_client
              from finance_clients c
              left join academies a on a.id = c.linked_academy_id
              where c.id = v_id;

              select value into v_methods from platform_settings where key = 'platform_payment_methods';

              return (
                jsonb_build_object(
                  'client_name', coalesce(v_client.academy_name, v_client.name),
                  'payment_methods', coalesce(v_methods, '{}'::jsonb)
                ) || app.finance_account_dues(v_id)
              )::json;
            end;
            $$;

            create or replace function app.submit_account_payment(
              p_token  text,
              p_method text,
              p_path   text,
              p_amount bigint,
              p_note   text
            )
            returns json
            language plpgsql security definer
            set search_path = public, pg_catalog
            as $$
            declare
              v_id       uuid;
              v_currency text;
              v_sub      uuid;
            begin
              v_id := app.finance_client_by_pay_token(p_token);
              if v_id is null then
                return null;
              end if;

              -- The proof is in the currency of what is owed first (the oldest open deal's).
              select d.currency into v_currency
              from finance_deals d
              where d.client_id = v_id and d.status = 'ACTIVE'
              order by d.started_on, d.created_at
              limit 1;

              v_sub := uuid_generate_v7();
              insert into finance_payment_submissions (id, client_id, method, amount_minor, currency, note, screenshot_path, status)
              values (v_sub, v_id, p_method, p_amount, coalesce(v_currency, 'EGP'), nullif(trim(p_note), ''), p_path, 'PENDING');

              return json_build_object('ok', true, 'submission_id', v_sub);
            end;
            $$;
        SQL);

        // ── The academy's own dashboard: its account, for the owner only ──
        DB::unprepared(<<<'SQL'
            create or replace function app.my_account_dues()
            returns json
            language plpgsql stable security definer
            set search_path = public, pg_catalog
            as $$
            declare
              v_academy uuid := app.current_academy_id();
              v_client  record;
            begin
              if v_academy is null then
                return null;
              end if;
              select id, pay_token into v_client from finance_clients where linked_academy_id = v_academy limit 1;
              if v_client.id is null then
                return null;
              end if;
              return (jsonb_build_object('pay_token', v_client.pay_token) || app.finance_account_dues(v_client.id))::json;
            end;
            $$;
        SQL);

        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass)) {
            DB::unprepared("grant select on finance_clients, finance_deals, finance_installments, finance_payments to {$bypass};");
            DB::unprepared("grant select, insert on finance_payment_submissions to {$bypass};");
            DB::unprepared("grant select on academies, academy_invoices, platform_settings to {$bypass};");
            foreach ([
                'app.finance_account_dues(uuid)',
                'app.finance_client_by_pay_token(text)',
                'app.public_account_by_token(text)',
                'app.submit_account_payment(text,text,text,bigint,text)',
                'app.my_account_dues()',
            ] as $fn) {
                DB::unprepared("alter function {$fn} owner to {$bypass};");
            }
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.my_account_dues();
            drop function if exists app.submit_account_payment(text, text, text, bigint, text);
            drop function if exists app.public_account_by_token(text);
            drop function if exists app.finance_client_by_pay_token(text);
            drop function if exists app.finance_account_dues(uuid);

            alter table finance_payments drop column if exists submission_id;
            drop table if exists finance_payment_submissions;
            drop table if exists finance_reminder_log;

            alter table finance_deals drop column if exists ends_on;
            alter table finance_deals drop constraint if exists finance_deals_list_amount_chk;
            alter table finance_deals drop column if exists list_amount_minor;
            alter table finance_deals drop constraint finance_deals_service_chk;
            alter table finance_deals add constraint finance_deals_service_chk
              check (service in ('COURSE_SITE', 'MANAGEMENT_SYSTEM', 'VIDEO_PLATFORM', 'WHATSAPP_SERVICE', 'CUSTOM_WORK', 'HOSTING', 'OTHER'));
            alter table finance_deals drop constraint finance_deals_interval_chk;
            alter table finance_deals add constraint finance_deals_interval_chk
              check (billing_interval is null or billing_interval in ('MONTHLY', 'QUARTERLY', 'YEARLY'));

            drop index if exists finance_clients_pay_token_uidx;
            drop index if exists finance_clients_academy_uidx;
            alter table finance_clients drop constraint if exists finance_clients_plan_chk;
            alter table finance_clients drop column if exists pay_token;
            alter table finance_clients drop column if exists plan;
            alter table finance_clients drop column if exists linked_academy_id;
        SQL);
    }
};
