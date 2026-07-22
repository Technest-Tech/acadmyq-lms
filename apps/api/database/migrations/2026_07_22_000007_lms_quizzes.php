<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * LMS phase 4 — quizzes & certificates (docs/lms/04 §quizzes, docs/lms/01 §Phase 4).
 *
 * A quiz belongs to a course and is attached to a lesson via `lessons.quiz_id` (the FK is wired here
 * now that the target table exists — the column has been a bare uuid since phase 1). Questions are
 * SINGLE / MULTIPLE / TRUE_FALSE with weighted `points`; a learner's `quiz_attempts` grades server-side
 * (correct-answer flags on `quiz_options.is_correct` are NEVER sent to the learner) and, on pass, marks
 * the lesson complete. `course_certificates` records issuance on full course completion (unique per
 * learner+course) with a printable `serial`.
 *
 * All tenant tables (RLS tenant_isolation), every child carrying academy_id so the one policy scopes
 * it. Learner-side writes (attempt/answers) run under the subdomain's academy context, so the
 * `with check` admits them exactly as it does staff writes. No FORCE-RLS toggle DDL (keeps the
 * migrate/rollback test from poisoning the suite).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table quizzes (
              id           uuid primary key default uuid_generate_v7(),
              academy_id   uuid not null references academies(id) on delete cascade,
              course_id    uuid not null references courses(id) on delete cascade,
              title        text,
              pass_mark    int not null default 60,                    -- percent to pass
              max_attempts int,                                        -- null = unlimited
              created_at   timestamptz not null default now(),
              updated_at   timestamptz not null default now()
            );
            create index quizzes_course_idx on quizzes (course_id);

            alter table quizzes enable row level security;
            alter table quizzes force row level security;
            create policy tenant_isolation on quizzes
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            -- Wire the phase-1 placeholder column to the new table (SET NULL: deleting a quiz leaves
            -- the QUIZ lesson intact but unpopulated, same as media_asset_id).
            alter table lessons
              add constraint lessons_quiz_id_fkey foreign key (quiz_id) references quizzes(id) on delete set null;

            create table quiz_questions (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              quiz_id     uuid not null references quizzes(id) on delete cascade,
              prompt      text not null,
              type        text not null check (type in ('SINGLE','MULTIPLE','TRUE_FALSE')),
              points      int not null default 1,
              position    int not null default 0,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );
            create index quiz_questions_quiz_idx on quiz_questions (quiz_id, position);

            alter table quiz_questions enable row level security;
            alter table quiz_questions force row level security;
            create policy tenant_isolation on quiz_questions
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table quiz_options (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              question_id uuid not null references quiz_questions(id) on delete cascade,
              text        text not null,
              is_correct  boolean not null default false,               -- NEVER sent to the learner
              position    int not null default 0
            );
            create index quiz_options_question_idx on quiz_options (question_id, position);

            alter table quiz_options enable row level security;
            alter table quiz_options force row level security;
            create policy tenant_isolation on quiz_options
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table quiz_attempts (
              id           uuid primary key default uuid_generate_v7(),
              academy_id   uuid not null references academies(id) on delete cascade,
              learner_id   uuid not null references learners(id) on delete cascade,
              quiz_id      uuid not null references quizzes(id) on delete cascade,
              score        int,                                          -- percent, set at submit
              passed       boolean,
              started_at   timestamptz not null default now(),
              submitted_at timestamptz
            );
            create index quiz_attempts_learner_quiz_idx on quiz_attempts (learner_id, quiz_id);

            alter table quiz_attempts enable row level security;
            alter table quiz_attempts force row level security;
            create policy tenant_isolation on quiz_attempts
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table quiz_answers (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id) on delete cascade,
              attempt_id          uuid not null references quiz_attempts(id) on delete cascade,
              question_id         uuid not null references quiz_questions(id) on delete cascade,
              selected_option_ids jsonb not null default '[]'::jsonb     -- array of chosen option ids
            );
            create index quiz_answers_attempt_idx on quiz_answers (attempt_id);

            alter table quiz_answers enable row level security;
            alter table quiz_answers force row level security;
            create policy tenant_isolation on quiz_answers
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table course_certificates (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              learner_id  uuid not null references learners(id) on delete cascade,
              course_id   uuid not null references courses(id) on delete cascade,
              serial      text not null,                                 -- printable verification code
              issued_at   timestamptz not null default now(),
              unique (learner_id, course_id)
            );
            create index course_certificates_course_idx on course_certificates (academy_id, course_id);

            alter table course_certificates enable row level security;
            alter table course_certificates force row level security;
            create policy tenant_isolation on course_certificates
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on course_certificates;
            drop table if exists course_certificates;
            drop policy if exists tenant_isolation on quiz_answers;
            drop table if exists quiz_answers;
            drop policy if exists tenant_isolation on quiz_attempts;
            drop table if exists quiz_attempts;
            drop policy if exists tenant_isolation on quiz_options;
            drop table if exists quiz_options;
            drop policy if exists tenant_isolation on quiz_questions;
            drop table if exists quiz_questions;
            alter table lessons drop constraint if exists lessons_quiz_id_fkey;
            drop policy if exists tenant_isolation on quizzes;
            drop table if exists quizzes;
        SQL);
    }
};
