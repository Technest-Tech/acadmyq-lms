<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * LMS phase 2 — access codes, enrollment, and progress (docs/lms/03-ACCESS-CODES-AND-ENROLLMENT).
 *
 * The academy's paywall substitute: staff generate `access_codes` scoped to one or more courses
 * (`access_code_courses`), hand them out, and a learner redeems one (`code_redemptions`) to become
 * enrolled (`enrollments` — the gate every learner-facing content endpoint checks). `lesson_progress`
 * records the resume point + completion per learner per lesson.
 *
 * All tenant tables (RLS tenant_isolation), every child carrying academy_id so the one policy scopes
 * it. Learner-side writes (redeem, progress) run under the subdomain's academy context, so the
 * `with check` admits them exactly as it does staff writes.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table access_codes (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id) on delete cascade,
              code              text not null,
              label             text,
              max_redemptions   int,                                  -- null = unlimited, 1 = single-use
              redemptions_count int not null default 0,
              expires_at        timestamptz,
              is_active         boolean not null default true,
              created_by        uuid,
              created_at        timestamptz not null default now(),
              updated_at        timestamptz not null default now(),
              unique (academy_id, code)
            );
            create index access_codes_academy_idx on access_codes (academy_id, is_active);

            alter table access_codes enable row level security;
            alter table access_codes force row level security;
            create policy tenant_isolation on access_codes
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table access_code_courses (
              academy_id  uuid not null references academies(id) on delete cascade,
              code_id     uuid not null references access_codes(id) on delete cascade,
              course_id   uuid not null references courses(id) on delete cascade,
              primary key (code_id, course_id)
            );
            create index access_code_courses_course_idx on access_code_courses (course_id);

            alter table access_code_courses enable row level security;
            alter table access_code_courses force row level security;
            create policy tenant_isolation on access_code_courses
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table code_redemptions (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              code_id     uuid not null references access_codes(id) on delete cascade,
              learner_id  uuid not null references learners(id) on delete cascade,
              redeemed_at timestamptz not null default now(),
              unique (code_id, learner_id)
            );
            create index code_redemptions_learner_idx on code_redemptions (learner_id);

            alter table code_redemptions enable row level security;
            alter table code_redemptions force row level security;
            create policy tenant_isolation on code_redemptions
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table enrollments (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id) on delete cascade,
              learner_id     uuid not null references learners(id) on delete cascade,
              course_id      uuid not null references courses(id) on delete cascade,
              source_code_id uuid references access_codes(id) on delete set null,
              status         text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
              enrolled_at    timestamptz not null default now(),
              unique (learner_id, course_id)
            );
            create index enrollments_academy_course_idx on enrollments (academy_id, course_id);

            alter table enrollments enable row level security;
            alter table enrollments force row level security;
            create policy tenant_isolation on enrollments
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table lesson_progress (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id) on delete cascade,
              learner_id       uuid not null references learners(id) on delete cascade,
              course_id        uuid not null references courses(id) on delete cascade,
              lesson_id        uuid not null references lessons(id) on delete cascade,
              status           text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS','COMPLETED')),
              position_seconds int not null default 0,
              completed_at     timestamptz,
              updated_at       timestamptz not null default now(),
              unique (learner_id, lesson_id)
            );
            create index lesson_progress_learner_course_idx on lesson_progress (learner_id, course_id);

            alter table lesson_progress enable row level security;
            alter table lesson_progress force row level security;
            create policy tenant_isolation on lesson_progress
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on lesson_progress;
            drop table if exists lesson_progress;
            drop policy if exists tenant_isolation on enrollments;
            drop table if exists enrollments;
            drop policy if exists tenant_isolation on code_redemptions;
            drop table if exists code_redemptions;
            drop policy if exists tenant_isolation on access_code_courses;
            drop table if exists access_code_courses;
            drop policy if exists tenant_isolation on access_codes;
            drop table if exists access_codes;
        SQL);
    }
};
