<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Scheduling & sessions (§6.5). Schedules are weekly recurring *rules* expressed in a
 * timezone; `sessions` are the concrete UTC occurrences the Sprint 5 generator will
 * write. Billable/payable classification is DERIVED from `status` in code, not stored;
 * `billed`/`paid_to_teacher` are idempotency guards only.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- Weekly recurring template per student (R-SCH-1).
            create table schedules (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              student_id  uuid not null references students(id),
              teacher_id  uuid not null references teachers(id),   -- teacher at time of scheduling
              timezone    text not null,                          -- tz the local times are expressed in
              is_active   boolean not null default true,
              deleted_at  timestamptz,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );
            create index schedules_academy_idx on schedules (academy_id);
            create index schedules_student_idx on schedules (student_id);

            -- Per-weekday times (may differ per day, R-SCH-1). weekday: 0=Sun … 6=Sat.
            create table schedule_slots (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id),
              schedule_id      uuid not null references schedules(id) on delete cascade,
              weekday          smallint not null,
              start_time_local time not null,                     -- wall-clock in schedule.timezone
              duration_minutes smallint not null default 30,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now(),
              constraint schedule_slots_weekday_chk check (weekday between 0 and 6),
              unique (schedule_id, weekday, start_time_local)
            );
            create index schedule_slots_academy_idx on schedule_slots (academy_id);

            -- Concrete occurrences (generated in Sprint 5).
            create table sessions (
              id                  uuid primary key default uuid_generate_v7(),
              academy_id          uuid not null references academies(id),
              student_id          uuid not null references students(id),
              teacher_id          uuid not null references teachers(id),
              schedule_id         uuid references schedules(id),   -- source; NULL for ad-hoc
              scheduled_at_utc    timestamptz not null,            -- concrete instant
              duration_minutes    smallint not null,
              status              session_status not null default 'SCHEDULED',
              status_reason       text,                            -- who cancelled / why (R-SCH-2)
              original_session_id uuid references sessions(id),    -- if a reschedule of another
              billed              boolean not null default false,  -- idempotency (R-BIL-1)
              paid_to_teacher     boolean not null default false,  -- idempotency (R-PAY)
              created_at          timestamptz not null default now(),
              updated_at          timestamptz not null default now()
            );
            create index sessions_teacher_calendar_idx on sessions (academy_id, teacher_id, scheduled_at_utc);
            create index sessions_student_calendar_idx on sessions (academy_id, student_id, scheduled_at_utc);

            -- One report per session, dynamic values keyed by report_field_definitions.key.
            create table session_reports (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id),
              session_id        uuid not null unique references sessions(id),
              "values"          jsonb not null default '{}'::jsonb,
              filled_by_user_id uuid references users(id),         -- teacher or owner (R-BIL-4)
              filled_at         timestamptz,
              created_at        timestamptz not null default now(),
              updated_at        timestamptz not null default now()
            );
            create index session_reports_academy_idx on session_reports (academy_id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists session_reports;
            drop table if exists sessions;
            drop table if exists schedule_slots;
            drop table if exists schedules;
        SQL);
    }
};
