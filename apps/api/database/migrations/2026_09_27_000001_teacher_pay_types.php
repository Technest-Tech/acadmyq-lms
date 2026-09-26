<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * How a teacher is paid — three ways, one per teacher.
 *
 *   HOURLY       one hourly rate (`session_rate_minor`) for every lesson. What everyone had before.
 *   PER_STUDENT  an hourly rate per student (`teacher_student_rates`); a student with no rate of
 *                their own falls back to `session_rate_minor`, so the default rate still matters.
 *   FIXED        a monthly salary (`fixed_salary_minor`). Lessons still land on the statement so
 *                the month's work is visible, but each one pays 0 — the salary is the pay.
 *
 * Per-student rates are HOURLY and pro-rated by lesson length exactly like the single rate: a
 * 30-minute lesson with a 100/hr student pays 50. Pay is still snapshotted when a lesson is marked
 * attended (R-PAY-1/3), so editing a rate never rewrites a line already paid.
 *
 * `teacher_student_rates` hangs off the (teacher, student) PAIR, not the assignment row: an
 * assignment is closed and reopened on every reassignment, and a rate that vanished with it would
 * silently drop a returning student back to the default.
 *
 * `payouts.base_minor` is where the fixed salary lands on a monthly statement. The integrity rule
 * finalize checks becomes: total = base + Σ lines + rewards − deductions. Frozen after finalize
 * like every other money column on the statement.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table teachers
              add column pay_type text not null default 'HOURLY',
              add column fixed_salary_minor bigint not null default 0,
              add constraint teachers_pay_type_chk check (pay_type in ('HOURLY', 'PER_STUDENT', 'FIXED')),
              add constraint teachers_fixed_salary_chk check (fixed_salary_minor >= 0);

            create table teacher_student_rates (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              teacher_id  uuid not null references teachers(id) on delete cascade,
              student_id  uuid not null references students(id) on delete cascade,
              rate_minor  bigint not null,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              constraint teacher_student_rates_rate_chk check (rate_minor >= 0),
              unique (teacher_id, student_id)
            );
            create index teacher_student_rates_academy_idx on teacher_student_rates (academy_id);

            alter table teacher_student_rates enable row level security;
            alter table teacher_student_rates force row level security;
            create policy tenant_isolation on teacher_student_rates
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table payouts
              add column base_minor bigint not null default 0;
        SQL);

        // The finalized-statement guard learns the new money column.
        DB::unprepared(<<<'SQL'
            create or replace function forbid_finalized_payout_mutation() returns trigger
            language plpgsql as $$
            begin
              if old.finalized_at is not null then
                if new.finalized_at is distinct from old.finalized_at then
                  raise exception 'finalized payout is immutable';
                end if;
                if new.total_minor <> old.total_minor
                   or new.currency <> old.currency
                   or new.base_minor <> old.base_minor
                   or new.rewards_minor <> old.rewards_minor
                   or new.deductions_minor <> old.deductions_minor then
                  raise exception 'cannot modify totals of a finalized payout';
                end if;
              end if;
              return new;
            end;
            $$;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            create or replace function forbid_finalized_payout_mutation() returns trigger
            language plpgsql as $$
            begin
              if old.finalized_at is not null then
                if new.finalized_at is distinct from old.finalized_at then
                  raise exception 'finalized payout is immutable';
                end if;
                if new.total_minor <> old.total_minor
                   or new.currency <> old.currency
                   or new.rewards_minor <> old.rewards_minor
                   or new.deductions_minor <> old.deductions_minor then
                  raise exception 'cannot modify totals of a finalized payout';
                end if;
              end if;
              return new;
            end;
            $$;

            alter table payouts drop column if exists base_minor;

            drop policy if exists tenant_isolation on teacher_student_rates;
            drop table if exists teacher_student_rates;

            alter table teachers
              drop constraint if exists teachers_fixed_salary_chk,
              drop constraint if exists teachers_pay_type_chk,
              drop column if exists fixed_salary_minor,
              drop column if exists pay_type;
        SQL);
    }
};
