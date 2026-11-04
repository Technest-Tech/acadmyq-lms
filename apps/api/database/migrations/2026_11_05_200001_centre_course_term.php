<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A group as a course (docs/centre-profile, Phase 2 §2). A centre's group is a TERM: "English A2,
 * Sat/Tue 5pm, 24 lessons, 1 Sep → 30 Nov". The group already had its dates; what it lacked was
 * how many lessons the term promises, where a term came from when it is renewed or its students
 * promoted, why it closed — and the names waiting at the door of a full one.
 *
 *   - `class_groups.lessons_planned`     — the lessons the term promises (null = not a counted course).
 *   - `class_groups.continues_group_id`  — the term this one carried on from (renewed / promoted).
 *   - `class_groups.closed_reason`       — why an archived group ended: RENEWED, PROMOTED or CLOSED
 *                                          (null = archived by hand, as before).
 *   - `class_group_waitlist`             — the queue for a full group: a student of the academy OR a
 *                                          walk-in name + phone, in order. One WAITING row per student
 *                                          per group; seated or removed rows stay as history.
 *
 * Additive: every new column is nullable, a Quran academy's rows read exactly as they did.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups
              add column if not exists lessons_planned smallint,
              add column if not exists continues_group_id uuid references class_groups(id) on delete set null,
              add column if not exists closed_reason text;

            alter table class_groups drop constraint if exists class_groups_lessons_planned_chk;
            alter table class_groups add constraint class_groups_lessons_planned_chk
              check (lessons_planned is null or lessons_planned > 0);
            alter table class_groups drop constraint if exists class_groups_closed_reason_chk;
            alter table class_groups add constraint class_groups_closed_reason_chk
              check (closed_reason is null or closed_reason in ('RENEWED','PROMOTED','CLOSED'));
            create index if not exists class_groups_continues_idx on class_groups (academy_id, continues_group_id);

            create table if not exists class_group_waitlist (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              group_id    uuid not null references class_groups(id) on delete cascade,
              student_id  uuid references students(id) on delete cascade,
              name        text,
              phone       text,
              note        text,
              position    int not null,
              status      text not null default 'WAITING',
              added_by    uuid references users(id),
              seated_at   timestamptz,
              removed_at  timestamptz,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              constraint class_group_waitlist_who_chk    check (student_id is not null or (name is not null and length(btrim(name)) > 0)),
              constraint class_group_waitlist_status_chk check (status in ('WAITING','SEATED','REMOVED'))
            );
            create unique index if not exists class_group_waitlist_one_waiting_idx
              on class_group_waitlist (group_id, student_id) where student_id is not null and status = 'WAITING';
            create index if not exists class_group_waitlist_queue_idx
              on class_group_waitlist (academy_id, group_id, status, position);

            alter table class_group_waitlist enable row level security;
            alter table class_group_waitlist force row level security;
            drop policy if exists tenant_isolation on class_group_waitlist;
            create policy tenant_isolation on class_group_waitlist
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on class_group_waitlist;
            drop table if exists class_group_waitlist;
            alter table class_groups drop constraint if exists class_groups_closed_reason_chk;
            alter table class_groups drop constraint if exists class_groups_lessons_planned_chk;
            alter table class_groups
              drop column if exists closed_reason,
              drop column if exists continues_group_id,
              drop column if exists lessons_planned;
        SQL);
    }
};
