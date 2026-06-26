<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Video conferencing (docs/video-platform/03-DATA-MODEL.md). Three tenant-scoped tables:
 *   - video_rooms        : a persistent classroom owned by an academy (and usually a teacher),
 *                          mapped 1:1 to a LiveKit room via the globally-unique `livekit_name`.
 *   - room_participants  : join/leave history per room session (the "history" value prop).
 *   - room_recordings    : an on-demand Egress recording, with retention + consent metadata.
 *
 * Conventions match every other tenant table: uuid_generate_v7() PKs, timestamptz, the standard
 * FORCE RLS `tenant_isolation` policy (academy_id = app.current_academy_id()), and the shared
 * set_updated_at() trigger. No SECURITY DEFINER functions are needed — the webhook resolves the
 * academy from the `__<academyId>` suffix embedded in `livekit_name`, then writes inside the
 * normal tenant context.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create type video_room_status      as enum ('ACTIVE','ARCHIVED');
            create type video_recording_status as enum ('STARTING','RECORDING','COMPLETED','FAILED','ABORTED');

            -- ── video_rooms ──────────────────────────────────────────────────────
            create table video_rooms (
              id              uuid primary key default uuid_generate_v7(),
              academy_id      uuid not null references academies(id),
              teacher_id      uuid references teachers(id),          -- owner/host; null = academy-level room
              name            text not null,
              livekit_name    text not null unique,                  -- globally-unique; carries the academy suffix
              status          video_room_status not null default 'ACTIVE',
              record_default  boolean not null default false,        -- V-REC-1: off unless explicitly enabled
              config          jsonb not null default '{}'::jsonb,
              created_at      timestamptz not null default now(),
              updated_at      timestamptz not null default now(),
              deleted_at      timestamptz
            );
            create index video_rooms_academy_idx on video_rooms (academy_id);
            create index video_rooms_teacher_idx on video_rooms (academy_id, teacher_id);
            create trigger trg_set_updated_at before update on video_rooms
              for each row execute function set_updated_at();

            -- ── room_participants (attendance/history) ───────────────────────────
            create table room_participants (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              room_id       uuid not null references video_rooms(id) on delete cascade,
              session_id    uuid references sessions(id),
              identity      text not null,                           -- LiveKit participant identity
              display_name  text,
              user_id       uuid references users(id),               -- set for authenticated joiners
              student_id    uuid references students(id),            -- set for guest joiners resolved to a student
              role          text not null default 'PARTICIPANT',
              joined_at     timestamptz not null default now(),
              left_at       timestamptz,
              created_at    timestamptz not null default now(),
              updated_at    timestamptz not null default now(),
              constraint room_participants_role_chk check (role in ('HOST','CO_HOST','PARTICIPANT'))
            );
            create index room_participants_academy_idx on room_participants (academy_id);
            create index room_participants_room_idx on room_participants (academy_id, room_id, joined_at);
            create trigger trg_set_updated_at before update on room_participants
              for each row execute function set_updated_at();

            -- ── room_recordings ──────────────────────────────────────────────────
            create table room_recordings (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              room_id       uuid not null references video_rooms(id) on delete cascade,
              session_id    uuid references sessions(id),
              student_id    uuid references students(id),
              egress_id     text unique,                             -- LiveKit egress id (idempotent webhooks)
              status        video_recording_status not null default 'STARTING',
              storage_key   text,                                    -- S3 object key (signed-URL access only)
              bytes         bigint,
              duration_s    integer,
              consent       boolean not null default false,          -- V-SEC-2 (minors)
              consent_note  text,
              started_at    timestamptz,
              ended_at      timestamptz,
              expires_at    timestamptz,                             -- V-REC-2 retention; purge-job target
              created_at    timestamptz not null default now(),
              updated_at    timestamptz not null default now()
            );
            create index room_recordings_academy_idx on room_recordings (academy_id);
            create index room_recordings_room_idx    on room_recordings (academy_id, room_id);
            create index room_recordings_expiry_idx  on room_recordings (expires_at) where status = 'COMPLETED';
            create trigger trg_set_updated_at before update on room_recordings
              for each row execute function set_updated_at();
        SQL);

        // RLS: FORCE + the standard tenant_isolation policy on all three (V-TEN-1).
        DB::unprepared(<<<'SQL'
            alter table video_rooms enable row level security;
            alter table video_rooms force row level security;
            create policy tenant_isolation on video_rooms
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table room_participants enable row level security;
            alter table room_participants force row level security;
            create policy tenant_isolation on room_participants
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table room_recordings enable row level security;
            alter table room_recordings force row level security;
            create policy tenant_isolation on room_recordings
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists room_recordings;
            drop table if exists room_participants;
            drop table if exists video_rooms;
            drop type  if exists video_recording_status;
            drop type  if exists video_room_status;
        SQL);
    }
};
