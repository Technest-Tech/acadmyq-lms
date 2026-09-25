<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A teacher's meeting link, and the "Enter" click that is measured against it.
 *
 * `teachers.meeting_url` is the room the teacher teaches in — a Zoom, Google Meet, Teams… link.
 * Free text behind a URL check in the controller: every provider shapes its links differently and
 * none of them is ours to parse. One link per teacher, because that is how these academies work: a
 * teacher has a personal room and every student is sent to it.
 *
 * `teachers.join_tracking_since` is the first instant this teacher ever had a link. Punctuality is
 * only measured from there: the lessons taught before the academy added the link had no Enter
 * button to press, and counting them as "never entered" would bury the real number under history.
 * Set once and never cleared — changing or removing the link later does not restart the clock.
 *
 * `session_joins` is the log: one row per press of Enter, stamped by the SERVER's clock (the
 * browser's clock is not evidence). Every press is kept — a teacher who drops and rejoins shows
 * both — and the statistics read the FIRST press of each lesson as "when they entered". Rows are
 * immutable; nothing edits or deletes a press.
 *
 * No new capability: the only person who can press Enter on a lesson is the teacher teaching it,
 * which the controller checks against the teacher row itself.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table teachers
              add column meeting_url text,
              add column join_tracking_since timestamptz;

            create table session_joins (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              session_id  uuid not null references sessions(id) on delete cascade,
              teacher_id  uuid not null references teachers(id) on delete cascade,
              user_id     uuid references users(id) on delete set null,
              joined_at   timestamptz not null default now(),
              created_at  timestamptz not null default now()
            );
            create index session_joins_session_idx on session_joins (session_id, joined_at);
            create index session_joins_teacher_idx on session_joins (academy_id, teacher_id, joined_at desc);

            alter table session_joins enable row level security;
            alter table session_joins force row level security;
            create policy tenant_isolation on session_joins
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on session_joins;
            drop table if exists session_joins;
            alter table teachers
              drop column if exists join_tracking_since,
              drop column if exists meeting_url;
        SQL);
    }
};
