<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * LMS orders, checkout & manual payments (docs/lms/10). Turns the course site from "ask us for a
 * code" into a shop: a learner buys a course, transfers by InstaPay / Vodafone Cash / bank, uploads
 * the receipt, and the client approves it — which enrolls them in the same transaction.
 *
 * The access-code system is untouched and stays as the OFFLINE channel. What changes is that it
 * becomes per-course optional (`courses.code_enabled`) next to the new checkout
 * (`courses.checkout_enabled`), both defaulting to true so every existing course behaves exactly as
 * it does today until its owner says otherwise.
 *
 * Every table here is tenant-scoped and carries the standard FORCE-RLS `tenant_isolation` policy —
 * both readers (staff under a normal tenant context, learners under ResolveAcademyContext) are the
 * same academy, so one policy covers the whole feature.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── Per-course channel switches (docs/lms/10 §1) ─────────────────────────────────────────
        DB::unprepared(<<<'SQL'
            alter table courses
              add column checkout_enabled boolean not null default true,
              add column code_enabled     boolean not null default true;

            comment on column courses.checkout_enabled is
              'Show the Buy button. A free course (price_minor = 0) or a client with no active payment method never shows it regardless (docs/lms/10 §1).';
            comment on column courses.code_enabled is
              'Accept access-code redemptions for this course — the offline-sales channel (docs/lms/03).';
        SQL);

        // ── The client's receiving accounts ──────────────────────────────────────────────────────
        DB::unprepared(<<<'SQL'
            create table lms_payment_methods (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id) on delete cascade,
              type           text not null,
              label          text,
              account_name   text,
              account_number text,
              bank_name      text,
              instructions   text,
              is_active      boolean not null default false,
              position       int not null default 0,
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now(),
              constraint lms_payment_methods_type_chk
                check (type in ('INSTAPAY', 'VODAFONE_CASH', 'BANK_TRANSFER', 'OTHER')),
              -- One InstaPay handle per client, not five. OTHER is the escape hatch.
              constraint lms_payment_methods_unique unique (academy_id, type)
            );
            create index lms_payment_methods_active_idx
              on lms_payment_methods (academy_id, is_active, position);

            alter table lms_payment_methods enable row level security;
            alter table lms_payment_methods force row level security;
            create policy tenant_isolation on lms_payment_methods
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── Orders ───────────────────────────────────────────────────────────────────────────────
        DB::unprepared(<<<'SQL'
            create table course_orders (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id) on delete cascade,
              order_number        text not null,
              learner_id          uuid not null references learners(id) on delete cascade,
              course_id           uuid not null references courses(id) on delete cascade,
              -- Snapshots: a later price or profile change never rewrites what was sold.
              price_minor         bigint not null check (price_minor >= 0),
              currency            char(3) not null,
              status              text not null default 'AWAITING_PAYMENT',
              channel             text not null default 'MANUAL',
              payment_method_id   uuid references lms_payment_methods(id) on delete set null,
              payment_method_type text,
              buyer_name          text,
              buyer_email         text,
              buyer_phone         text,
              terms_accepted_at   timestamptz,
              submitted_at        timestamptz,
              confirmed_at        timestamptz,
              decided_by          uuid references users(id),
              rejection_reason    text,
              refunded_at         timestamptz,
              refund_reason       text,
              staff_note          text,
              created_at          timestamptz not null default now(),
              updated_at          timestamptz not null default now(),
              constraint course_orders_status_chk check (status in (
                'AWAITING_PAYMENT', 'UNDER_REVIEW', 'PAID', 'REJECTED', 'CANCELLED', 'REFUNDED')),
              constraint course_orders_channel_chk check (channel in ('MANUAL', 'GATEWAY')),
              constraint course_orders_number_unique unique (academy_id, order_number)
            );
            create index course_orders_status_idx  on course_orders (academy_id, status, created_at desc);
            create index course_orders_course_idx  on course_orders (academy_id, course_id);
            create index course_orders_learner_idx on course_orders (academy_id, learner_id, created_at desc);

            -- One OPEN order per learner+course: a double-click, a re-opened tab or two racing
            -- requests can never mint a second pending order for the same purchase (docs/lms/10 §3).
            create unique index course_orders_one_open_idx
              on course_orders (learner_id, course_id)
              where status in ('AWAITING_PAYMENT', 'UNDER_REVIEW');

            alter table course_orders enable row level security;
            alter table course_orders force row level security;
            create policy tenant_isolation on course_orders
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── Transfer receipts (many per order: a rejected one is kept, a new one is added) ───────
        DB::unprepared(<<<'SQL'
            create table course_order_receipts (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id) on delete cascade,
              order_id         uuid not null references course_orders(id) on delete cascade,
              method_id        uuid references lms_payment_methods(id) on delete set null,
              method_type      text not null,
              -- PRIVATE disk key. A receipt is a photo of someone's bank app; it never gets a
              -- public URL — staff read it through a capability-gated stream, exactly as Super
              -- Admins read academy_payment_submissions.screenshot_path.
              file_path        text not null,
              sender_name      text,
              sender_reference text,
              amount_minor     bigint,
              paid_at          timestamptz,
              note             text,
              review_status    text not null default 'PENDING',
              reviewed_by      uuid references users(id),
              reviewed_at      timestamptz,
              rejection_reason text,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now(),
              constraint course_order_receipts_status_chk
                check (review_status in ('PENDING', 'APPROVED', 'REJECTED'))
            );
            create index course_order_receipts_order_idx  on course_order_receipts (order_id, created_at desc);
            create index course_order_receipts_status_idx on course_order_receipts (academy_id, review_status);

            alter table course_order_receipts enable row level security;
            alter table course_order_receipts force row level security;
            create policy tenant_isolation on course_order_receipts
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── Enrollment provenance: bought, or redeemed a code, or granted by staff ───────────────
        DB::unprepared(<<<'SQL'
            alter table enrollments
              add column source_order_id uuid references course_orders(id) on delete set null;
            create index enrollments_source_order_idx on enrollments (source_order_id)
              where source_order_id is not null;

            comment on column enrollments.source_order_id is
              'The paid order that created this enrollment. Exactly one of source_order_id / source_code_id is set; both null = granted by staff (docs/lms/10 §1).';
        SQL);

        // ── Per-academy order numbering ──────────────────────────────────────────────────────────
        // A counter row per academy, bumped atomically. Per-academy so one client's numbering never
        // leaks another's sales volume, and human-quotable ("طلب رقم ORD-000123") on the phone.
        DB::unprepared(<<<'SQL'
            create table course_order_counters (
              academy_id  uuid primary key references academies(id) on delete cascade,
              last_number bigint not null default 0,
              updated_at  timestamptz not null default now()
            );

            alter table course_order_counters enable row level security;
            alter table course_order_counters force row level security;
            create policy tenant_isolation on course_order_counters
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create or replace function app.next_course_order_number(p_academy uuid)
            returns text
            language plpgsql
            as $$
            declare
                v_n bigint;
            begin
                -- One statement, so two concurrent buyers can never be handed the same number:
                -- the insert wins or the row lock of DO UPDATE serialises them.
                insert into course_order_counters (academy_id, last_number)
                values (p_academy, 1)
                on conflict (academy_id) do update
                    set last_number = course_order_counters.last_number + 1,
                        updated_at  = now()
                returning last_number into v_n;

                return 'ORD-' || lpad(v_n::text, 6, '0');
            end;
            $$;
        SQL);

        // ── The learner's own notification feed ──────────────────────────────────────────────────
        // Learners are not `users`, so the staff `notifications` table cannot address them (its
        // recipient_user_id FKs users). A parallel, deliberately tiny table (docs/lms/10 §2).
        DB::unprepared(<<<'SQL'
            create table learner_notifications (
              id         uuid primary key default uuid_generate_v7(),
              academy_id uuid not null references academies(id) on delete cascade,
              learner_id uuid not null references learners(id) on delete cascade,
              type       text not null,
              title      text not null,
              body       text,
              data       jsonb not null default '{}'::jsonb,
              read_at    timestamptz,
              created_at timestamptz not null default now()
            );
            create index learner_notifications_feed_idx
              on learner_notifications (academy_id, learner_id, created_at desc);
            create index learner_notifications_unread_idx
              on learner_notifications (academy_id, learner_id) where read_at is null;

            alter table learner_notifications enable row level security;
            alter table learner_notifications force row level security;
            create policy tenant_isolation on learner_notifications
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── Learner password reset ───────────────────────────────────────────────────────────────
        // Only the sha256 of the token is stored: a database leak must not hand out live reset
        // links. Delivery prefers WhatsApp (the academy's own session) over mail (docs/lms/10 §2).
        DB::unprepared(<<<'SQL'
            create table learner_password_resets (
              id         uuid primary key default uuid_generate_v7(),
              academy_id uuid not null references academies(id) on delete cascade,
              learner_id uuid not null references learners(id) on delete cascade,
              token_hash text not null,
              channel    text not null,
              expires_at timestamptz not null,
              used_at    timestamptz,
              created_at timestamptz not null default now(),
              constraint learner_password_resets_channel_chk check (channel in ('EMAIL', 'WHATSAPP'))
            );
            create index learner_password_resets_learner_idx
              on learner_password_resets (academy_id, learner_id, created_at desc);
            create index learner_password_resets_token_idx on learner_password_resets (token_hash);

            alter table learner_password_resets enable row level security;
            alter table learner_password_resets force row level security;
            create policy tenant_isolation on learner_password_resets
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on learner_password_resets;
            drop table if exists learner_password_resets;

            drop policy if exists tenant_isolation on learner_notifications;
            drop table if exists learner_notifications;

            drop function if exists app.next_course_order_number(uuid);
            drop policy if exists tenant_isolation on course_order_counters;
            drop table if exists course_order_counters;

            drop index if exists enrollments_source_order_idx;
            alter table enrollments drop column if exists source_order_id;

            drop policy if exists tenant_isolation on course_order_receipts;
            drop table if exists course_order_receipts;

            drop policy if exists tenant_isolation on course_orders;
            drop table if exists course_orders;

            drop policy if exists tenant_isolation on lms_payment_methods;
            drop table if exists lms_payment_methods;

            alter table courses drop column if exists code_enabled;
            alter table courses drop column if exists checkout_enabled;
        SQL);
    }
};
