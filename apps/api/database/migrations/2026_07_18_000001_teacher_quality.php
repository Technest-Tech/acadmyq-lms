<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Teacher quality — the academy's own rubric for judging how a teacher delivered, and the reports
 * written against it by the owner/support. Five tables:
 *
 *   • teacher_quality_categories — the rubric's top level ("Punctuality", "Lesson delivery").
 *   • teacher_quality_criteria   — a category's checkable sub-items, each carrying the
 *     `discount_percent` docked when the teacher did NOT meet it.
 *   • teacher_quality_reports    — one evaluation of one teacher, either SESSION-scoped (this
 *     lesson) or MONTHLY-scoped (the whole period's pay), holding the summed `total_percent`.
 *   • teacher_quality_report_items — the frozen answer sheet: every criterion evaluated, met or
 *     not, with the category/criterion NAME and PERCENT snapshotted so editing the rubric later
 *     never rewrites a report already served to the teacher.
 *   • teacher_quality_settings   — the per-academy auto-deduction policy (see the sibling
 *     AutoDeductUnreportedSessionsJob): dock a teacher who never marks a delivered session.
 *
 * Money is NOT stored here. A report holds a PERCENT; the cash it costs is a derived
 * `payout_adjustments` row (source=QUALITY) that {@see \App\Services\TeacherQuality::syncPayout}
 * recomputes while the payout is OPEN — because a MONTHLY report is "% of the month's total pay"
 * and that total keeps growing as sessions are attended. Finalizing the payout freezes it.
 *
 * Every percent is stored in BASIS POINTS as an integer (1% = 100 bp, so 10000 bp = 100%), never
 * as `numeric`. These columns are not money, but they MULTIPLY money to produce money — a 5%
 * deduction on a month's pay is a cash number a teacher is actually paid — so a float percent would
 * smuggle float arithmetic into the one path AC-1.10 exists to keep exact. Basis points keep the
 * whole calculation in integers (see TeacherQuality::applyBasisPoints) and give two decimal places
 * of percent, which is more precision than a rubric will ever need.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------------
        // 1 – The rubric: categories → criteria (each with its own penalty %).
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table teacher_quality_categories (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              name        text not null,
              description text,
              sort_order  smallint not null default 0,
              is_active   boolean not null default true,
              created_by  uuid,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              deleted_at  timestamptz
            );
            create index teacher_quality_categories_academy_idx
              on teacher_quality_categories (academy_id, sort_order) where deleted_at is null;

            create trigger trg_set_updated_at before update on teacher_quality_categories
              for each row execute function set_updated_at();

            create table teacher_quality_criteria (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              category_id uuid not null references teacher_quality_categories(id) on delete cascade,
              name        text not null,
              discount_bp integer not null,
              sort_order  smallint not null default 0,
              is_active   boolean not null default true,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              deleted_at  timestamptz,
              constraint teacher_quality_criteria_bp_chk
                check (discount_bp > 0 and discount_bp <= 10000)
            );
            create index teacher_quality_criteria_category_idx
              on teacher_quality_criteria (academy_id, category_id, sort_order) where deleted_at is null;

            create trigger trg_set_updated_at before update on teacher_quality_criteria
              for each row execute function set_updated_at();
        SQL);

        // ------------------------------------------------------------------
        // 2 – The reports + their frozen answer sheets.
        //
        //     `scope` decides what the percent bites into:
        //       SESSION → that one lesson's payout line.
        //       MONTHLY → the period's whole accrued pay.
        //     A SESSION report therefore REQUIRES a session_id and a MONTHLY one forbids it.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table teacher_quality_reports (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id) on delete cascade,
              teacher_id     uuid not null references teachers(id) on delete cascade,
              scope          text not null,
              session_id     uuid references sessions(id) on delete cascade,
              period_year    smallint not null,
              period_month   smallint not null,
              payout_id      uuid references payouts(id) on delete set null,
              total_bp       integer not null default 0,
              note           text,
              author_user_id uuid,
              author_name    text,
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now(),
              constraint teacher_quality_reports_scope_chk check (scope in ('SESSION','MONTHLY')),
              constraint teacher_quality_reports_session_chk check (
                (scope = 'SESSION' and session_id is not null)
                or (scope = 'MONTHLY' and session_id is null)
              ),
              constraint teacher_quality_reports_bp_chk
                check (total_bp >= 0 and total_bp <= 10000),
              constraint teacher_quality_reports_month_chk check (period_month between 1 and 12)
            );

            -- One quality report per session: a lesson is judged once.
            create unique index teacher_quality_reports_session_uniq
              on teacher_quality_reports (session_id) where session_id is not null;
            create index teacher_quality_reports_teacher_idx
              on teacher_quality_reports (academy_id, teacher_id, period_year desc, period_month desc);
            create index teacher_quality_reports_payout_idx
              on teacher_quality_reports (payout_id) where payout_id is not null;

            create trigger trg_set_updated_at before update on teacher_quality_reports
              for each row execute function set_updated_at();

            -- The answer sheet. category_name/criterion_name/discount_percent are SNAPSHOTS:
            -- renaming a criterion or re-pricing it must never restate a past report.
            create table teacher_quality_report_items (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id) on delete cascade,
              report_id      uuid not null references teacher_quality_reports(id) on delete cascade,
              criterion_id   uuid references teacher_quality_criteria(id) on delete set null,
              category_name  text not null,
              criterion_name text not null,
              discount_bp    integer not null,
              met            boolean not null,
              created_at     timestamptz not null default now()
            );
            create index teacher_quality_report_items_report_idx
              on teacher_quality_report_items (report_id);
        SQL);

        // ------------------------------------------------------------------
        // 3 – Per-academy auto-deduction policy (one row per academy).
        //     basis FIXED          → dock a flat `auto_deduct_amount_minor`.
        //     basis PERCENT_SESSION → dock `auto_deduct_bp` of what the unmarked session WOULD
        //                             have paid (rate × duration) — the session has no payout line
        //                             precisely because it was never marked.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table teacher_quality_settings (
              id                       uuid primary key default uuid_generate_v7(),
              academy_id               uuid not null references academies(id) on delete cascade unique,
              auto_deduct_enabled      boolean not null default false,
              auto_deduct_grace_hours  smallint not null default 6,
              auto_deduct_basis        text not null default 'FIXED',
              auto_deduct_amount_minor bigint not null default 0,
              auto_deduct_bp           integer not null default 0,
              created_at               timestamptz not null default now(),
              updated_at               timestamptz not null default now(),
              constraint teacher_quality_settings_basis_chk
                check (auto_deduct_basis in ('FIXED','PERCENT_SESSION')),
              constraint teacher_quality_settings_grace_chk
                check (auto_deduct_grace_hours between 1 and 168),
              constraint teacher_quality_settings_amount_chk check (auto_deduct_amount_minor >= 0),
              constraint teacher_quality_settings_bp_chk
                check (auto_deduct_bp >= 0 and auto_deduct_bp <= 10000)
            );

            create trigger trg_set_updated_at before update on teacher_quality_settings
              for each row execute function set_updated_at();
        SQL);

        // ------------------------------------------------------------------
        // 4 – RLS: the standard tenant policy on every table, FORCEd so the owning
        //     app role is subject to it too.
        // ------------------------------------------------------------------
        foreach ([
            'teacher_quality_categories',
            'teacher_quality_criteria',
            'teacher_quality_reports',
            'teacher_quality_report_items',
            'teacher_quality_settings',
        ] as $table) {
            DB::unprepared(<<<SQL
                alter table {$table} enable row level security;
                alter table {$table} force row level security;
                create policy tenant_isolation on {$table}
                  using (academy_id = app.current_academy_id())
                  with check (academy_id = app.current_academy_id());
            SQL);
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on teacher_quality_settings;
            drop policy if exists tenant_isolation on teacher_quality_report_items;
            drop policy if exists tenant_isolation on teacher_quality_reports;
            drop policy if exists tenant_isolation on teacher_quality_criteria;
            drop policy if exists tenant_isolation on teacher_quality_categories;

            drop table if exists teacher_quality_settings;
            drop table if exists teacher_quality_report_items;
            drop table if exists teacher_quality_reports;
            drop table if exists teacher_quality_criteria;
            drop table if exists teacher_quality_categories;
        SQL);
    }
};
