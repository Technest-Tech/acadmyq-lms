<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Group classes (docs/groups) — one teacher, several students, a weekly timetable of its own.
 *
 * Two decisions are baked into this schema and must not be re-litigated in code:
 *
 *  1. A GROUP LESSON IS NOT A `sessions` ROW. `sessions.student_id` is NOT NULL and two dozen
 *     surfaces (attendance, calendar, supervision, punctuality, the auto-deduct sweep, overdue and
 *     WhatsApp alerts, packages, payroll, video) read that table. Fanning a class out into one
 *     session per member would show, alert, deduct and pay it once PER STUDENT on every one of
 *     them. So the class keeps its own lessons and its own attendance sheet, exactly as a trial
 *     keeps its own row and travels to the calendar as a separate feed.
 *
 *  2. NAMED class_group*, NEVER group*. "Group" already means the academy's WhatsApp staff groups
 *     (whatsapp_group_alerts) — the same trap `lesson_packages` avoided against the Super-Admin
 *     "package".
 *
 * Statuses are text + CHECK rather than Postgres enums, so adding one later is a plain migration
 * (and `migrate:fresh` never trips on a leftover type).
 *
 * The `groups` feature is new in the MANAGEMENT module, and a module grants everything it owns —
 * so without step 4 every live client would find a Groups item in their sidebar on deploy. Each
 * existing MANAGEMENT subscription gets `groups` added to its switched-off list instead; the
 * Super Admin turns it on per client from the client's Features card. New clients get it on.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------------
        // 1 — The group and its weekly timetable.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table class_groups (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id),
              name              text not null,
              specialization_id uuid references specializations(id),   -- the subject, from the academy's own list
              level             text,                                  -- free text: "A1", "Level 3", "Grade 9"
              teacher_id        uuid not null references teachers(id),
              capacity          smallint,                              -- null = no limit
              mode              text not null default 'ONLINE',
              location          text,                                  -- room / branch, for an offline class
              meeting_url       text,                                  -- null = the teacher's own link
              timezone          text not null,
              start_date        date not null,
              end_date          date,                                  -- null = open-ended
              notes             text,
              status            text not null default 'ACTIVE',
              archived_at       timestamptz,
              created_by        uuid references users(id),
              created_at        timestamptz not null default now(),
              updated_at        timestamptz not null default now(),
              constraint class_groups_name_chk     check (length(btrim(name)) > 0),
              constraint class_groups_capacity_chk check (capacity is null or capacity > 0),
              constraint class_groups_mode_chk     check (mode in ('ONLINE','OFFLINE')),
              constraint class_groups_status_chk   check (status in ('ACTIVE','ARCHIVED')),
              constraint class_groups_dates_chk    check (end_date is null or end_date >= start_date)
            );
            create index class_groups_academy_idx on class_groups (academy_id, status);
            create index class_groups_teacher_idx on class_groups (academy_id, teacher_id);

            create table class_group_slots (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id),
              group_id         uuid not null references class_groups(id) on delete cascade,
              weekday          smallint not null,                    -- 0=Sun … 6=Sat, as schedule_slots
              start_time_local time not null,                        -- wall-clock in class_groups.timezone
              duration_minutes smallint not null,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now(),
              constraint class_group_slots_weekday_chk  check (weekday between 0 and 6),
              constraint class_group_slots_duration_chk check (duration_minutes between 1 and 600),
              unique (group_id, weekday, start_time_local)
            );
            create index class_group_slots_academy_idx on class_group_slots (academy_id);
        SQL);

        // ------------------------------------------------------------------
        // 2 — Who is in it. A membership is a date range, so joining in week 3 never makes a
        //     student "absent" for weeks 1–2, and leaving never rewrites the sheets already kept.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table class_group_members (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              group_id    uuid not null references class_groups(id) on delete cascade,
              student_id  uuid not null references students(id),
              joined_on   date not null,
              left_on     date,
              status      text not null default 'ACTIVE',
              left_reason text,
              added_by    uuid references users(id),
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              constraint class_group_members_status_chk check (status in ('ACTIVE','LEFT')),
              constraint class_group_members_left_chk
                check ((status = 'LEFT') = (left_on is not null)),
              constraint class_group_members_dates_chk check (left_on is null or left_on >= joined_on)
            );
            -- One open membership per (group, student); a student who left can rejoin later.
            create unique index class_group_members_one_open
              on class_group_members (group_id, student_id) where status = 'ACTIVE';
            create index class_group_members_student_idx on class_group_members (academy_id, student_id);
            create index class_group_members_group_idx on class_group_members (group_id, status);
        SQL);

        // ------------------------------------------------------------------
        // 3 — The lessons and their attendance sheet.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create table class_group_lessons (
              id                    uuid primary key default uuid_generate_v7(),
              academy_id            uuid not null references academies(id),
              group_id              uuid not null references class_groups(id) on delete cascade,
              teacher_id            uuid not null references teachers(id),   -- snapshot: a substitute is possible
              slot_id               uuid references class_group_slots(id) on delete set null, -- null = extra lesson
              occurrence_local_date date not null,
              scheduled_at_utc      timestamptz not null,
              duration_minutes      smallint not null,
              status                text not null default 'SCHEDULED',
              cancel_reason         text,
              moved_at              timestamptz,     -- moved by hand: the generator never drags it back
              is_extra              boolean not null default false, -- added by hand (حصة تعويض), not from a slot
              topic                 text,            -- what was taught
              homework              text,
              notes                 text,
              outcome_set_at        timestamptz,
              outcome_set_by        uuid references users(id),
              created_at            timestamptz not null default now(),
              updated_at            timestamptz not null default now(),
              constraint class_group_lessons_status_chk   check (status in ('SCHEDULED','HELD','CANCELLED')),
              constraint class_group_lessons_duration_chk check (duration_minutes between 1 and 600)
            );
            -- Generation idempotency: one lesson per (slot, local date), ever.
            create unique index class_group_lessons_occurrence_uidx
              on class_group_lessons (group_id, slot_id, occurrence_local_date) where slot_id is not null;
            create index class_group_lessons_group_idx on class_group_lessons (group_id, scheduled_at_utc);
            create index class_group_lessons_calendar_idx on class_group_lessons (academy_id, scheduled_at_utc);
            create index class_group_lessons_teacher_idx on class_group_lessons (academy_id, teacher_id, scheduled_at_utc);

            create table class_group_attendance (
              id         uuid primary key default uuid_generate_v7(),
              academy_id uuid not null references academies(id),
              lesson_id  uuid not null references class_group_lessons(id) on delete cascade,
              group_id   uuid not null references class_groups(id) on delete cascade,
              student_id uuid not null references students(id),
              status     text not null,
              note       text,
              marked_by  uuid references users(id),
              marked_at  timestamptz not null default now(),
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now(),
              constraint class_group_attendance_status_chk check (status in ('PRESENT','LATE','ABSENT','EXCUSED')),
              unique (lesson_id, student_id)
            );
            create index class_group_attendance_student_idx on class_group_attendance (academy_id, student_id);
            create index class_group_attendance_group_idx on class_group_attendance (group_id);
        SQL);

        // ------------------------------------------------------------------
        // Tenant isolation — the standard policy on every table (§7).
        // ------------------------------------------------------------------
        foreach (['class_groups', 'class_group_slots', 'class_group_members', 'class_group_lessons', 'class_group_attendance'] as $table) {
            DB::unprepared(<<<SQL
                alter table {$table} enable row level security;
                alter table {$table} force row level security;
                create policy tenant_isolation on {$table}
                  using (academy_id = app.current_academy_id())
                  with check (academy_id = app.current_academy_id());
            SQL);
        }

        // ------------------------------------------------------------------
        // 4 — The switch: a kill-switch row, and OFF for every client that exists today.
        // ------------------------------------------------------------------
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        if (DB::table('feature_flags')->where('key', 'groups')->doesntExist()) {
            DB::table('feature_flags')->insert([
                'id' => (string) Str::uuid(),
                'key' => 'groups',
                'description' => 'Group classes — groups, members, timetable & attendance',
                'enabled' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->switchOffForExistingClients();
    }

    /**
     * Add `groups` to the switched-off list of every live MANAGEMENT subscription that exists right
     * now, so no client's sidebar changes on deploy. Idempotent (a second run adds nothing) and
     * public so the test suite can run it against fixtures (tests/Feature/Groups).
     */
    public function switchOffForExistingClients(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        // module_subscriptions is under FORCE row-level security, so the write runs academy by
        // academy with the tenant GUC set (the pattern of 2026_10_19_000001_sessions_hidden_at).
        // Containment (@>) rather than jsonb's key-exists operator: PDO reads that operator's
        // question mark as a binding placeholder.
        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

            DB::statement(<<<'SQL'
                update module_subscriptions
                   set overrides = jsonb_set(
                         case when jsonb_typeof(overrides) = 'object' then overrides else '{}'::jsonb end,
                         '{disabled}',
                         case when jsonb_typeof(overrides->'disabled') = 'array'
                              then overrides->'disabled' else '[]'::jsonb end || '["groups"]'::jsonb
                       ),
                       updated_at = now()
                 where module = 'MANAGEMENT'
                   and status <> 'ENDED'
                   and not coalesce(jsonb_typeof(overrides->'disabled') = 'array'
                                    and overrides->'disabled' @> '["groups"]'::jsonb, false)
            SQL);
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

            DB::statement(<<<'SQL'
                update module_subscriptions
                   set overrides = jsonb_set(overrides, '{disabled}', (overrides->'disabled') - 'groups')
                 where module = 'MANAGEMENT'
                   and overrides->'disabled' @> '["groups"]'::jsonb
            SQL);
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");

        DB::table('feature_flags')->where('key', 'groups')->delete();

        DB::unprepared(<<<'SQL'
            drop table if exists class_group_attendance;
            drop table if exists class_group_lessons;
            drop table if exists class_group_members;
            drop table if exists class_group_slots;
            drop table if exists class_groups;
        SQL);
    }
};
