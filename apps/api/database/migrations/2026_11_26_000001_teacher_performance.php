<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Teacher performance, rebuilt as a monthly evaluation (2026-11-18). The page used to read only
 * what the system records by itself (Enter presses, report times, attendance). A supervisor also
 * judges a teacher by hand, and that had nowhere to live. Three tables:
 *
 *   • teacher_conduct_notes — what the supervisor records against a teacher: an ABSENCE, an
 *     APOLOGY (the teacher excused themselves) or a VIOLATION (a rule of the academy was not
 *     kept, named in `rule`). Each carries the `points` it cost on the day it was written, so
 *     changing the academy's point values later never restates a month already judged. A note
 *     may name the lesson it is about; one lesson is classified once.
 *   • teacher_lesson_visits — the supervisor sat in a lesson and rated it: one row per visit,
 *     its `items` the answer sheet ([{criterion_id, name, rating 1–5}], names snapshotted like
 *     the old quality reports) and `score` the 0–100 result.
 *   • teacher_performance_settings — one row per academy: the weight of each of the four
 *     parts of the monthly total, the points per kind of note, how many visits a teacher should
 *     get a month, the two clocks (late entry, report window), and the academy's own lists of
 *     rating criteria and rules.
 *
 * Whole numbers only: a score is 0–100, a rating 1–5, a weight a percent. Nothing here is money
 * and nothing here touches pay — the old rubric that docked a payout stays where it was.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists teacher_conduct_notes (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id) on delete cascade,
              teacher_id     uuid not null references teachers(id) on delete cascade,
              kind           text not null,
              occurred_on    date not null,
              session_id     uuid references sessions(id) on delete set null,
              rule           text,
              note           text,
              points         smallint not null default 0,
              author_user_id uuid references users(id) on delete set null,
              author_name    text,
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now(),
              deleted_at     timestamptz,
              constraint teacher_conduct_notes_kind_chk check (kind in ('ABSENCE','APOLOGY','VIOLATION')),
              constraint teacher_conduct_notes_points_chk check (points between 0 and 100)
            );
            create index if not exists teacher_conduct_notes_teacher_idx
              on teacher_conduct_notes (academy_id, teacher_id, occurred_on desc) where deleted_at is null;
            -- A lesson is classified once: an absence cannot also be an apology.
            create unique index if not exists teacher_conduct_notes_session_uniq
              on teacher_conduct_notes (session_id) where session_id is not null and deleted_at is null;

            create table if not exists teacher_lesson_visits (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id) on delete cascade,
              teacher_id     uuid not null references teachers(id) on delete cascade,
              visited_on     date not null,
              session_id     uuid references sessions(id) on delete set null,
              score          smallint not null,
              items          jsonb not null default '[]'::jsonb,
              strengths      text,
              improvements   text,
              author_user_id uuid references users(id) on delete set null,
              author_name    text,
              created_at     timestamptz not null default now(),
              updated_at     timestamptz not null default now(),
              deleted_at     timestamptz,
              constraint teacher_lesson_visits_score_chk check (score between 0 and 100)
            );
            create index if not exists teacher_lesson_visits_teacher_idx
              on teacher_lesson_visits (academy_id, teacher_id, visited_on desc) where deleted_at is null;

            create table if not exists teacher_performance_settings (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null unique references academies(id) on delete cascade,
              weight_quality   smallint not null default 40,
              weight_reports   smallint not null default 20,
              weight_entry     smallint not null default 20,
              weight_conduct   smallint not null default 20,
              absence_points   smallint not null default 10,
              apology_points   smallint not null default 3,
              violation_points smallint not null default 5,
              visits_target    smallint not null default 2,
              late_minutes     smallint not null default 5,
              report_minutes   integer not null default 120,
              criteria         jsonb not null default '[]'::jsonb,
              rules            jsonb not null default '[]'::jsonb,
              updated_by       uuid references users(id) on delete set null,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now(),
              constraint teacher_performance_settings_weights_chk check (
                weight_quality >= 0 and weight_reports >= 0 and weight_entry >= 0 and weight_conduct >= 0
                and weight_quality + weight_reports + weight_entry + weight_conduct = 100
              ),
              constraint teacher_performance_settings_points_chk check (
                absence_points between 0 and 100 and apology_points between 0 and 100
                and violation_points between 0 and 100
              ),
              constraint teacher_performance_settings_clocks_chk check (
                visits_target between 0 and 31 and late_minutes between 0 and 240
                and report_minutes between 0 and 10080
              )
            );
        SQL);

        foreach (['teacher_conduct_notes', 'teacher_lesson_visits', 'teacher_performance_settings'] as $table) {
            DB::unprepared(<<<SQL
                drop trigger if exists trg_set_updated_at on {$table};
                create trigger trg_set_updated_at before update on {$table}
                  for each row execute function set_updated_at();

                alter table {$table} enable row level security;
                alter table {$table} force row level security;
                drop policy if exists tenant_isolation on {$table};
                create policy tenant_isolation on {$table}
                  using (academy_id = app.current_academy_id())
                  with check (academy_id = app.current_academy_id());
            SQL);
        }
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on teacher_performance_settings;
            drop policy if exists tenant_isolation on teacher_lesson_visits;
            drop policy if exists tenant_isolation on teacher_conduct_notes;
            drop table if exists teacher_performance_settings;
            drop table if exists teacher_lesson_visits;
            drop table if exists teacher_conduct_notes;
        SQL);
    }
};
