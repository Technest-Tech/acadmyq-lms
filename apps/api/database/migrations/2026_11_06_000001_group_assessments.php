<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Exams and grades for a group, and the term report they feed (docs/centre-profile, Phase 2 §5).
 * A centre examines — quizzes, a mid-term, a final, homework marks — and a parent asks how their
 * child is doing. The memorisation report a Quran academy writes per lesson is the wrong shape for
 * that; a centre's answer is a grade sheet per group and one report per student per group.
 *
 *   - `group_assessments`        — one column of the grade sheet: a title, a kind, the day it was
 *                                  held, the mark it is out of, and a weight for the total.
 *   - `group_assessment_scores`  — one cell: a student's score on one assessment, or that they were
 *                                  absent from it. Unique per (assessment, student).
 *   - `group_term_reports`       — the teacher's comment and the overall grade for one student in
 *                                  one group, and when (and by whom) it was published to the parent.
 *                                  Attendance and grades are never copied here: the report is
 *                                  composed from the sheets and the scores each time it is read.
 *
 * All three are tenant tables behind the standard FORCE row-level-security policy. Kinds are text +
 * CHECK (like class_group_lessons.status), so adding one later is a plain migration. Nothing an
 * existing table holds changes: a Quran academy has no rows here and sees nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists group_assessments (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              group_id    uuid not null references class_groups(id) on delete cascade,
              title       text not null,
              kind        text not null default 'QUIZ'
                          check (kind in ('QUIZ','HOMEWORK','MIDTERM','FINAL','ORAL','PROJECT','OTHER')),
              held_on     date,
              max_score   numeric(7,2) not null check (max_score > 0),
              weight      numeric(5,2) not null default 1 check (weight >= 0),
              sort_order  int not null default 0,
              created_by  uuid references users(id),
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );
            create index if not exists group_assessments_group_idx on group_assessments (academy_id, group_id);

            alter table group_assessments enable row level security;
            alter table group_assessments force row level security;
            drop policy if exists tenant_isolation on group_assessments;
            create policy tenant_isolation on group_assessments
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table if not exists group_assessment_scores (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              assessment_id uuid not null references group_assessments(id) on delete cascade,
              student_id    uuid not null references students(id),
              score         numeric(7,2) check (score is null or score >= 0),
              absent        boolean not null default false,
              note          text,
              graded_by     uuid references users(id),
              graded_at     timestamptz,
              created_at    timestamptz not null default now(),
              updated_at    timestamptz not null default now(),
              unique (assessment_id, student_id)
            );
            create index if not exists group_assessment_scores_student_idx on group_assessment_scores (academy_id, student_id);

            alter table group_assessment_scores enable row level security;
            alter table group_assessment_scores force row level security;
            drop policy if exists tenant_isolation on group_assessment_scores;
            create policy tenant_isolation on group_assessment_scores
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table if not exists group_term_reports (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              group_id      uuid not null references class_groups(id) on delete cascade,
              student_id    uuid not null references students(id),
              comment       text,
              overall_grade text,
              published_at  timestamptz,
              published_by  uuid references users(id),
              created_by    uuid references users(id),
              created_at    timestamptz not null default now(),
              updated_at    timestamptz not null default now(),
              unique (group_id, student_id)
            );
            create index if not exists group_term_reports_student_idx on group_term_reports (academy_id, student_id);

            alter table group_term_reports enable row level security;
            alter table group_term_reports force row level security;
            drop policy if exists tenant_isolation on group_term_reports;
            create policy tenant_isolation on group_term_reports
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on group_term_reports;
            drop table if exists group_term_reports;
            drop policy if exists tenant_isolation on group_assessment_scores;
            drop table if exists group_assessment_scores;
            drop policy if exists tenant_isolation on group_assessments;
            drop table if exists group_assessments;
        SQL);
    }
};
