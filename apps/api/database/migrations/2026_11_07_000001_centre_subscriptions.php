<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The centre's private subscription, off the Quran hour-block engine
 * (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md): the same one-to-one lesson
 * (`schedules` → `sessions`), its own money object.
 *
 *  centre_subscriptions         a block of N LESSONS sold to one student for one subject (teacher +
 *                               course; untied when the student has one teacher), priced per
 *                               lesson. Its money is ONE bill line (`invoice_line_id`), re-issued in
 *                               place when the block is edited and brought down by a settlement.
 *                               No minutes, no hourly rate, no overdraft, no carry-over, no renewal
 *                               chain: a lesson is one lesson, money moves only when the desk acts.
 *  centre_subscription_lessons  which lesson sat on which block. `subscription_id` NULL = a lesson
 *                               attended OUTSIDE any block (the block ran out, or none was sold):
 *                               the flag the desk follows up, taken by the next block sold for that
 *                               subject from its start date. `session_id` is UNIQUE: a lesson counts
 *                               once, on one block, ever.
 *
 * Additive: `lesson_packages` stays as it is until the data move (`centre:migrate-packages`), which
 * remembers the old row in `legacy_package_id`. RLS as every tenant table. No triggers beyond the
 * ledger's existing ones (a repriced line gives excess allocations back by itself).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table centre_subscriptions (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id),
              student_id          uuid not null references students(id),
              teacher_id          uuid references teachers(id),
              course              text,
              label               text not null,
              lessons_sold        integer not null,
              lesson_minutes      integer,
              lesson_price_minor  bigint not null,
              price_minor         bigint not null,
              currency            char(3) not null,
              starts_on           date not null,
              status              text not null default 'OPEN',
              finished_at         timestamptz,
              closed_at           timestamptz,
              closed_reason       text,
              closed_by           uuid references users(id),
              invoice_id          uuid references invoices(id),
              invoice_line_id     uuid references invoice_line_items(id) on delete set null,
              settlement          text,
              settled_minor       bigint,
              settled_at          timestamptz,
              settled_by          uuid references users(id),
              settle_note         text,
              settle_expense_id   uuid references expenses(id),
              sequence_no         integer not null,
              reminders_sent      integer not null default 0,
              last_reminded_at    timestamptz,
              legacy_package_id   uuid references lesson_packages(id),
              opened_by           uuid references users(id),
              created_at          timestamptz not null default now(),
              updated_at          timestamptz not null default now(),
              constraint centre_subscriptions_sold_chk       check (lessons_sold > 0),
              constraint centre_subscriptions_minutes_chk    check (lesson_minutes is null or lesson_minutes > 0),
              constraint centre_subscriptions_price_chk      check (lesson_price_minor >= 0 and price_minor >= 0),
              constraint centre_subscriptions_status_chk     check (status in ('OPEN','FINISHED','CLOSED','CANCELLED')),
              constraint centre_subscriptions_sequence_chk   check (sequence_no >= 1),
              constraint centre_subscriptions_settlement_chk check (settlement is null or settlement in ('PENDING','CREDIT','REFUND','KEEP')),
              constraint centre_subscriptions_settled_chk    check ((settled_at is null) = (settlement is null or settlement = 'PENDING'))
            );

            create index centre_subscriptions_academy_idx on centre_subscriptions (academy_id, status);
            create index centre_subscriptions_student_idx on centre_subscriptions (student_id, sequence_no desc);
            create index centre_subscriptions_invoice_idx on centre_subscriptions (invoice_id) where invoice_id is not null;
            create index centre_subscriptions_line_idx on centre_subscriptions (invoice_line_id) where invoice_line_id is not null;
            create unique index centre_subscriptions_legacy_uidx on centre_subscriptions (legacy_package_id) where legacy_package_id is not null;

            -- "Subscription #N" means the same thing for ever.
            create unique index centre_subscriptions_sequence_uidx on centre_subscriptions (student_id, sequence_no);

            -- One OPEN block per subject (teacher + course), and one untied block per student.
            create unique index centre_subscriptions_one_open_per_subject
              on centre_subscriptions (student_id, teacher_id, lower(coalesce(course, '')))
              where status = 'OPEN' and teacher_id is not null;
            create unique index centre_subscriptions_one_open_untied
              on centre_subscriptions (student_id)
              where status = 'OPEN' and teacher_id is null;

            create table centre_subscription_lessons (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id),
              subscription_id  uuid references centre_subscriptions(id) on delete cascade,
              session_id       uuid not null references sessions(id),
              student_id       uuid not null references students(id),
              teacher_id       uuid references teachers(id),
              course           text,
              lesson_on        date not null,
              counted_at       timestamptz,
              created_at       timestamptz not null default now()
            );

            create unique index centre_subscription_lessons_session_uidx on centre_subscription_lessons (session_id);
            create index centre_subscription_lessons_subscription_idx on centre_subscription_lessons (subscription_id, lesson_on);
            create index centre_subscription_lessons_outside_idx on centre_subscription_lessons (student_id, lesson_on) where subscription_id is null;
            create index centre_subscription_lessons_academy_idx on centre_subscription_lessons (academy_id);

            alter table centre_subscriptions enable row level security;
            alter table centre_subscriptions force row level security;
            create policy tenant_isolation on centre_subscriptions
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table centre_subscription_lessons enable row level security;
            alter table centre_subscription_lessons force row level security;
            create policy tenant_isolation on centre_subscription_lessons
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // The staff WhatsApp groups learn the subscription alerts (GroupAlertCatalog, ACCOUNTING).
        DB::unprepared(<<<'SQL'
            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'GROUP_LESSON_NOT_MARKED', 'REPORT_OVERDUE', 'TRIAL_STARTED', 'TRIAL_NOT_MARKED',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST',
              'LESSON_REMINDER', 'LESSON_STARTING',
              'SUBSCRIPTION_FINISHED', 'SUBSCRIPTION_UNPAID'
            ));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table whatsapp_group_alerts no force row level security;
            delete from whatsapp_group_alerts where event_type in ('SUBSCRIPTION_FINISHED', 'SUBSCRIPTION_UNPAID');
            alter table whatsapp_group_alerts force row level security;
            alter table whatsapp_group_alerts drop constraint whatsapp_group_alerts_event_chk;
            alter table whatsapp_group_alerts add constraint whatsapp_group_alerts_event_chk check (event_type in (
              'SESSION_STARTED', 'SESSION_NOT_MARKED', 'GROUP_LESSON_NOT_MARKED', 'REPORT_OVERDUE', 'TRIAL_STARTED', 'TRIAL_NOT_MARKED',
              'PACKAGE_LOW', 'PACKAGE_ENDED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'TEST',
              'LESSON_REMINDER', 'LESSON_STARTING'
            ));

            drop policy if exists tenant_isolation on centre_subscription_lessons;
            drop policy if exists tenant_isolation on centre_subscriptions;
            drop table if exists centre_subscription_lessons;
            drop table if exists centre_subscriptions;
        SQL);
    }
};
