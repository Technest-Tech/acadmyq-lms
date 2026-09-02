<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Lesson packages — hour-based prepaid/postpaid bundles (docs/lesson-packages).
 *
 * An academy sells a student a block of HOURS ("20 hours, 4000 EGP") instead of billing them
 * month by month. Every lesson the student actually owes money for burns its own duration out
 * of the balance; when the balance runs out the package closes and the bill is raised (or was
 * already raised at the start).
 *
 * Three decisions are baked into this schema and must not be re-litigated in code:
 *
 *  1. MINUTES, NEVER HOURS. Every quantity is an integer count of minutes. Hours are a display
 *     concern. Floating-point hours in a billing table is how you get 0.30000000004 disputes.
 *
 *  2. ONE LESSON = ONE PACKAGE = ONE INVOICE LINE. A 90-minute lesson against a 30-minute
 *     balance does NOT split across two packages. It overdraws: the package closes at −60 and
 *     those 60 minutes are charged at the snapshotted hourly rate. That rule is enforced by the
 *     `unique (session_id)` on the credits ledger — the database physically cannot record a
 *     lesson consuming two packages.
 *
 *  3. CONSUMPTION IS NOT COLLECTION. The ledger records which lesson ate which minutes and is
 *     never gated on payment; a teacher is never blocked mid-lesson because a parent hasn't
 *     paid. Whether the package's invoice is paid is a fact about the INVOICE. "He's on package
 *     #3 with #2 unpaid" is therefore reportable rather than prevented.
 *
 * A student is on package billing when their subscription's price_basis is PER_PACKAGE, and
 * then the monthly AUTO-invoice path never runs for them — Invoicing::onSessionBillable
 * delegates to LessonPackages instead. Two billing clocks on one student is a double-bill, so
 * the two modes are mutually exclusive by construction.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------------
        // 1 — PER_PACKAGE joins the allowed subscription price bases.
        //     For a package student `subscriptions.price_minor` is read as the DEFAULT hourly
        //     rate used to pre-fill the next package; the authoritative rate is snapshotted
        //     onto the package row itself at creation and never recomputed.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table subscriptions drop constraint if exists subscriptions_price_basis_chk;
            alter table subscriptions add constraint subscriptions_price_basis_chk
              check (price_basis in ('PER_SESSION','PER_MONTH','PER_HOUR','PER_PACKAGE'));
        SQL);

        // ------------------------------------------------------------------
        // 2 — The academy-wide default for when a package is billed. Per-package overrides it.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table academies
              add column if not exists package_bill_timing text not null default 'ON_START';

            alter table academies drop constraint if exists academies_package_bill_timing_chk;
            alter table academies add constraint academies_package_bill_timing_chk
              check (package_bill_timing in ('ON_START','ON_COMPLETION'));

            comment on column academies.package_bill_timing is
              'Default lesson-package billing moment: ON_START (invoice raised when the package opens) or ON_COMPLETION (invoice raised from actual consumption when it closes)';
        SQL);

        // ------------------------------------------------------------------
        // 3 — The packages themselves.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table lesson_packages (
              id                   uuid primary key default uuid_generate_v7(),
              academy_id           uuid not null references academies(id),
              student_id           uuid not null references students(id),
              label                text not null,                  -- display, e.g. '20 hours'
              minutes_total        integer not null,               -- package size, in minutes
              minutes_consumed     integer not null default 0,     -- running total (ledger is the audit trail)
              carried_over_minutes integer not null default 0,     -- minutes brought in from the previous package
              minutes_overdrawn    integer not null default 0,     -- how far the final lesson pushed past the balance
              price_minor          bigint not null,                -- agreed total for the package (snapshot, R-INV-3)
              currency             char(3) not null,
              hourly_rate_minor    bigint not null,                -- snapshot: price_minor * 60 / minutes_total
              bill_timing          text not null default 'ON_START',
              status               text not null default 'ACTIVE',
              sequence_no          integer not null,               -- 1, 2, 3 … per student
              starts_on            date not null,
              expires_on           date,                           -- optional; null = never expires
              invoice_id           uuid references invoices(id),   -- the package's own bill
              overdraft_invoice_id uuid references invoices(id),   -- where the overdraft landed (ON_START case)
              closed_at            timestamptz,
              closed_reason        text,
              opened_by_user_id    uuid references users(id),
              created_at           timestamptz not null default now(),
              updated_at           timestamptz not null default now(),
              constraint lesson_packages_minutes_total_chk   check (minutes_total > 0),
              constraint lesson_packages_minutes_signs_chk   check (minutes_consumed >= 0 and carried_over_minutes >= 0 and minutes_overdrawn >= 0),
              constraint lesson_packages_price_chk           check (price_minor >= 0 and hourly_rate_minor >= 0),
              constraint lesson_packages_bill_timing_chk     check (bill_timing in ('ON_START','ON_COMPLETION')),
              constraint lesson_packages_status_chk          check (status in ('ACTIVE','COMPLETED','CANCELLED')),
              constraint lesson_packages_sequence_chk        check (sequence_no >= 1),
              constraint lesson_packages_expiry_chk          check (expires_on is null or expires_on >= starts_on)
            );

            create index lesson_packages_academy_idx on lesson_packages (academy_id, status);
            create index lesson_packages_student_idx on lesson_packages (academy_id, student_id, sequence_no desc);
            create index lesson_packages_invoice_idx on lesson_packages (invoice_id) where invoice_id is not null;

            -- At most ONE open package per student. The "start a new package before the old one
            -- is paid" case is about the previous package's INVOICE, not about running two
            -- balances at once — a student can never be burning two packages simultaneously.
            create unique index lesson_packages_one_active_per_student
              on lesson_packages (student_id) where status = 'ACTIVE';

            -- Stable, gapless ordering per student, so "package #2" means the same thing forever.
            create unique index lesson_packages_sequence_uidx
              on lesson_packages (student_id, sequence_no);
        SQL);

        // ------------------------------------------------------------------
        // 4 — The consumption ledger. One row per lesson, ever.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table lesson_package_credits (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id),
              package_id        uuid not null references lesson_packages(id) on delete cascade,
              student_id        uuid not null references students(id),
              session_id        uuid not null references sessions(id),
              minutes           integer not null,                 -- the lesson's full duration
              minutes_overdrawn integer not null default 0,        -- the slice beyond the balance
              amount_minor      bigint  not null default 0,        -- 0 inside the package; the overdraft charge otherwise
              currency          char(3) not null,
              description       text not null,
              consumed_at       timestamptz not null default now(),
              created_at        timestamptz not null default now(),
              constraint lpc_minutes_chk           check (minutes > 0),
              constraint lpc_overdrawn_range_chk   check (minutes_overdrawn >= 0 and minutes_overdrawn <= minutes),
              constraint lpc_amount_chk            check (amount_minor >= 0)
            );

            -- THE rule, in the schema: a lesson can consume from exactly one package, exactly once.
            -- Mirrors invoice_line_items' unique (invoice_id, session_id) idempotency discipline.
            create unique index lesson_package_credits_session_uidx
              on lesson_package_credits (session_id);
            create index lesson_package_credits_package_idx on lesson_package_credits (package_id, consumed_at);
            create index lesson_package_credits_academy_idx on lesson_package_credits (academy_id);
        SQL);

        // ------------------------------------------------------------------
        // 5 — Notifications gain a generic subject anchor.
        //     The existing dedupe is `unique (session_id, type)`, but a package alert is anchored
        //     to a PACKAGE, not a session. Rather than overload session_id, add subject_id and
        //     give it the same one-alert-per-subject-per-type guarantee.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table notifications add column if not exists subject_id uuid;

            comment on column notifications.subject_id is
              'Generic anchor for non-session alerts (e.g. a lesson_packages.id). Deduped per (subject_id, type) exactly as session alerts are deduped per (session_id, type).';

            create unique index if not exists notifications_subject_type_idx
              on notifications (subject_id, type) where subject_id is not null;

            create index if not exists notifications_category_idx
              on notifications (academy_id, category, created_at desc);
        SQL);

        // ------------------------------------------------------------------
        // 6 — Tenant isolation. Identical standard policy to every other tenant table (§7):
        //     the app connects as the table owner, so FORCE is what actually makes it bite.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table lesson_packages enable row level security;
            alter table lesson_packages force row level security;
            create policy tenant_isolation on lesson_packages
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table lesson_package_credits enable row level security;
            alter table lesson_package_credits force row level security;
            create policy tenant_isolation on lesson_package_credits
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on lesson_package_credits;
            drop policy if exists tenant_isolation on lesson_packages;
            drop table if exists lesson_package_credits;
            drop table if exists lesson_packages;

            drop index if exists notifications_subject_type_idx;
            drop index if exists notifications_category_idx;
            alter table notifications drop column if exists subject_id;

            alter table academies drop constraint if exists academies_package_bill_timing_chk;
            alter table academies drop column if exists package_bill_timing;

            alter table subscriptions drop constraint if exists subscriptions_price_basis_chk;
            alter table subscriptions add constraint subscriptions_price_basis_chk
              check (price_basis in ('PER_SESSION','PER_MONTH','PER_HOUR'));
        SQL);
    }
};
