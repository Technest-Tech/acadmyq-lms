<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * People (§6.3) — all tenant-scoped and history-bearing (soft delete via deleted_at;
 * hard delete is prohibited in app code, design decision §3.7).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table teachers (
              id                 uuid primary key default uuid_generate_v7(),
              academy_id         uuid not null references academies(id),
              user_id            uuid references users(id),         -- linked login
              full_name          text not null,
              phone              text,
              specialization     text,
              session_rate_minor bigint not null,                  -- payroll rate (R-PAY-1)
              currency           char(3) not null,                 -- (R-PAY-3)
              timezone           text,                             -- overrides academy tz
              is_active          boolean not null default true,
              deleted_at         timestamptz,
              created_at         timestamptz not null default now(),
              updated_at         timestamptz not null default now()
            );
            create index teachers_academy_idx on teachers (academy_id);

            -- The payer; may own multiple students (R-STU-1).
            create table guardians (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id),
              full_name      text not null,
              whatsapp_phone text not null,                        -- report & invoice recipient
              country        text,
              currency       char(3) not null,                    -- default for their invoices
              deleted_at     timestamptz,
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now()
            );
            create index guardians_academy_idx on guardians (academy_id);

            create table students (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id),
              guardian_id    uuid not null references guardians(id),  -- adult solo = own guardian (R-STU-2)
              full_name      text not null,
              whatsapp_phone text,
              country        text,
              status         text,                                 -- display status ('REGULAR'…), not billing
              deleted_at     timestamptz,
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now()
            );
            create index students_academy_idx on students (academy_id);
            create index students_guardian_idx on students (guardian_id);

            -- Current + historical teacher per student (R-STU-3).
            create table student_teacher_assignments (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              student_id  uuid not null references students(id),
              teacher_id  uuid not null references teachers(id),
              started_at  timestamptz not null default now(),
              ended_at    timestamptz,                             -- NULL = current active assignment
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );
            -- Enforce exactly one active teacher per student (R-STU-3).
            create unique index sta_one_active_per_student
              on student_teacher_assignments (student_id)
              where ended_at is null;
            create index sta_academy_idx on student_teacher_assignments (academy_id);
            create index sta_teacher_idx on student_teacher_assignments (teacher_id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists student_teacher_assignments;
            drop table if exists students;
            drop table if exists guardians;
            drop table if exists teachers;
        SQL);
    }
};
