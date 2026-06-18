<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Student progress reports (teacher → owner review).
 *
 * A TEACHER writes a free-text monthly progress report about one of their assigned students and
 * submits it for the OWNER to review from the Notifications page ("Student Reports" tab). The
 * report sits PENDING until the owner APPROVES or REJECTS it (with an optional note) — the same
 * request/approve workflow as `session_cancellation_requests`. Once decided, a report is locked:
 * to redo a month the teacher writes a NEW report, so at most one PENDING report may exist per
 * (student, teacher, month) at a time.
 *
 * academy_id carries the standard tenant policy under FORCE RLS — tenant isolation is a database
 * guarantee, not an app convention (§7), matching every other tenant-scoped table.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table student_progress_reports (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id),
              student_id          uuid not null references students(id),
              teacher_id          uuid not null references teachers(id),
              created_by_user_id  uuid references users(id),       -- submitting teacher login
              period_month        date not null,                   -- normalized to the 1st of the month
              title               text not null,
              body                text not null,
              status              text not null default 'PENDING', -- PENDING | APPROVED | REJECTED
              review_note         text,
              reviewed_by_user_id uuid references users(id),
              reviewed_at         timestamptz,
              seen_by_teacher_at  timestamptz,                     -- teacher has viewed the decision
              created_at          timestamptz not null default now(),
              updated_at          timestamptz not null default now(),
              constraint spr_status_chk check (status in ('PENDING','APPROVED','REJECTED'))
            );
            create index spr_academy_status_idx on student_progress_reports (academy_id, status);
            create index spr_teacher_idx on student_progress_reports (academy_id, teacher_id);
            create index spr_student_idx on student_progress_reports (academy_id, student_id);
            -- At most one PENDING report per (student, teacher, month) — the submit endpoint also
            -- guards this; a decided report is locked, so a new one can be written for that month.
            create unique index spr_one_pending_per_month
              on student_progress_reports (academy_id, student_id, teacher_id, period_month)
              where status = 'PENDING';

            -- Standard tenant policy (FORCE RLS) — identical to every other tenant-scoped table (§7).
            alter table student_progress_reports enable row level security;
            alter table student_progress_reports force row level security;
            create policy tenant_isolation on student_progress_reports
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on student_progress_reports;
            drop table if exists student_progress_reports;
        SQL);
    }
};
