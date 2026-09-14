<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * WhatsApp group alerts — an academy's staff groups ("Supervision", "Accounting") told about what is
 * happening in the academy, over the academy's own linked WhatsApp number.
 *
 *   • whatsapp_groups        — a WhatsApp group linked to a client, and which alerts it receives.
 *   • whatsapp_group_alerts  — one row per (group, alert, subject): the idempotency ledger AND the
 *                              delivery record. A row walks PENDING → QUEUED (the gateway took it) →
 *                              SENT (WhatsApp took it) → DELIVERED (a member's phone received it).
 *                              Several rows can ride one WhatsApp message, so they share its id.
 *   • invoice_payment_events — every rise in an invoice's paid amount, written by a trigger so the
 *                              three payment writers (manual mark-paid, PayPal, XPay — the last two
 *                              SECURITY DEFINER functions with no tenant context) cannot miss one.
 *
 * automation_send_log learns a GROUP recipient and a GROUP_ALERT type so every group message still
 * shows up in the Super Admin activity feed. Both check lists are rewritten whole, so they carry
 * every value earlier migrations added — dropping one silently breaks that feature's inserts.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table whatsapp_groups (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              jid         text not null,
              name        text not null,                       -- the group's WhatsApp subject when linked
              label       text,                                -- what the academy calls it: "Supervision"
              language    text not null default 'ar',
              events      jsonb not null default '[]'::jsonb,  -- alert types this group receives
              -- type → instant it was switched on. Detection never looks before it, so ticking a box
              -- tells the group what happens from now on instead of replaying the last three days.
              event_since jsonb not null default '{}'::jsonb,
              settings    jsonb not null default '{}'::jsonb,  -- per-group timings (minutes / hours)
              is_active   boolean not null default true,
              created_by  uuid references users(id) on delete set null,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              constraint whatsapp_groups_jid_chk check (jid like '%@g.us'),
              constraint whatsapp_groups_language_chk check (language in ('ar', 'en'))
            );
            create unique index whatsapp_groups_academy_jid_uidx on whatsapp_groups (academy_id, jid);

            alter table whatsapp_groups enable row level security;
            alter table whatsapp_groups force row level security;
            create policy tenant_isolation on whatsapp_groups
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table whatsapp_group_alerts (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id) on delete cascade,
              group_id            uuid not null references whatsapp_groups(id) on delete cascade,
              event_type          text not null,
              subject_key         text not null,                -- the session / notification / payment it is about
              payload             jsonb not null default '{}'::jsonb,
              -- When the alert became true (a lesson's start, start + N min, end + N h, the moment
              -- money landed). Expiry is measured from here, not from when the sweep noticed.
              due_at              timestamptz not null,
              status              text not null default 'PENDING',
              attempts            smallint not null default 0,
              provider_message_id text,
              error               text,
              next_attempt_at     timestamptz not null default now(),
              queued_at           timestamptz,
              sent_at             timestamptz,
              delivered_at        timestamptz,
              read_at             timestamptz,
              created_at          timestamptz not null default now(),
              updated_at          timestamptz not null default now(),
              constraint whatsapp_group_alerts_event_chk check (event_type in (
                'SESSION_STARTED', 'SESSION_NOT_MARKED', 'REPORT_OVERDUE',
                'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'TEST'
              )),
              constraint whatsapp_group_alerts_status_chk check (status in (
                'PENDING', 'SENDING', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED', 'EXPIRED'
              ))
            );
            create unique index whatsapp_group_alerts_subject_uidx
              on whatsapp_group_alerts (group_id, event_type, subject_key);
            create index whatsapp_group_alerts_work_idx
              on whatsapp_group_alerts (academy_id, status, next_attempt_at);
            create index whatsapp_group_alerts_message_idx
              on whatsapp_group_alerts (provider_message_id) where provider_message_id is not null;
            create index whatsapp_group_alerts_recent_idx
              on whatsapp_group_alerts (group_id, created_at desc);

            alter table whatsapp_group_alerts enable row level security;
            alter table whatsapp_group_alerts force row level security;
            create policy tenant_isolation on whatsapp_group_alerts
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table invoice_payment_events (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id) on delete cascade,
              invoice_id          uuid not null references invoices(id) on delete cascade,
              amount_minor        bigint not null,              -- this payment: the rise in amount_paid_minor
              paid_total_minor    bigint not null,              -- amount_paid_minor after it
              invoice_total_minor bigint not null,
              currency            char(3) not null,
              status_after        invoice_status not null,
              payment_method      payment_method,
              occurred_at         timestamptz not null default now()
            );
            create index invoice_payment_events_academy_idx
              on invoice_payment_events (academy_id, occurred_at desc);

            alter table invoice_payment_events enable row level security;
            alter table invoice_payment_events force row level security;
            create policy tenant_isolation on invoice_payment_events
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // A payment must never fail because its event could not be written, so the insert swallows
        // its own error (a subtransaction: the invoice update still commits). SECURITY DEFINER under
        // the BYPASSRLS role below, because PayPal/XPay settle with no tenant context set.
        DB::unprepared(<<<'SQL'
            create or replace function app.record_invoice_payment_event()
            returns trigger
            language plpgsql
            security definer
            set search_path = public, pg_catalog
            as $$
            begin
                begin
                    insert into invoice_payment_events (
                        academy_id, invoice_id, amount_minor, paid_total_minor,
                        invoice_total_minor, currency, status_after, payment_method
                    ) values (
                        new.academy_id, new.id,
                        coalesce(new.amount_paid_minor, 0) - coalesce(old.amount_paid_minor, 0),
                        coalesce(new.amount_paid_minor, 0), new.total_minor,
                        new.currency, new.status, new.payment_method
                    );
                exception when others then
                    raise warning 'invoice_payment_events insert failed for invoice %: %', new.id, sqlerrm;
                end;
                return null;
            end;
            $$;

            create trigger trg_invoice_payment_event
              after update of amount_paid_minor on invoices
              for each row
              when (coalesce(new.amount_paid_minor, 0) > coalesce(old.amount_paid_minor, 0))
              execute function app.record_invoice_payment_event();
        SQL);

        DB::unprepared(<<<'SQL'
            alter table automation_send_log
              drop constraint if exists automation_send_log_automation_type_check;
            alter table automation_send_log
              add constraint automation_send_log_automation_type_check
              check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL', 'API', 'LMS', 'GROUP_ALERT'));

            alter table automation_send_log
              drop constraint if exists automation_send_log_recipient_kind_check;
            alter table automation_send_log
              add constraint automation_send_log_recipient_kind_check
              check (recipient_kind in ('STUDENT', 'GUARDIAN', 'TEACHER', 'ACADEMY_OWNER', 'EXTERNAL', 'LEARNER', 'GROUP'));
        SQL);

        $bypass = (string) config('database.rls.bypass_role', '');
        if ($bypass !== '' && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $bypass) === 1) {
            DB::unprepared("grant select, insert on invoice_payment_events to {$bypass};");
            DB::unprepared("alter function app.record_invoice_payment_event() owner to {$bypass};");
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            delete from automation_send_log
             where automation_type = 'GROUP_ALERT' or recipient_kind = 'GROUP';

            alter table automation_send_log
              drop constraint if exists automation_send_log_recipient_kind_check;
            alter table automation_send_log
              add constraint automation_send_log_recipient_kind_check
              check (recipient_kind in ('STUDENT', 'GUARDIAN', 'TEACHER', 'ACADEMY_OWNER', 'EXTERNAL', 'LEARNER'));

            alter table automation_send_log
              drop constraint if exists automation_send_log_automation_type_check;
            alter table automation_send_log
              add constraint automation_send_log_automation_type_check
              check (automation_type in ('TYPE1_BILLING', 'TYPE2_LESSON', 'MANUAL', 'API', 'LMS'));

            drop trigger if exists trg_invoice_payment_event on invoices;
            drop function if exists app.record_invoice_payment_event();

            drop policy if exists tenant_isolation on invoice_payment_events;
            drop table if exists invoice_payment_events;
            drop policy if exists tenant_isolation on whatsapp_group_alerts;
            drop table if exists whatsapp_group_alerts;
            drop policy if exists tenant_isolation on whatsapp_groups;
            drop table if exists whatsapp_groups;
        SQL);
    }
};
