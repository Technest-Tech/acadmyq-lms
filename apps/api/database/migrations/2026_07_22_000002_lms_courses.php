<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * LMS module (entitled:lms) — the on-demand course content an academy publishes to its learners
 * (docs/lms/01-DATA-MODEL). Phase 1: the authoring side only (no learners / codes / enrollment yet,
 * those land in phase 2).
 *
 *  - `media_assets` is one uploaded video/audio file and its transcode lifecycle. In phase 1 only
 *    AUDIO (direct file, no HLS) is offered; VIDEO_UPLOAD → HLS transcode is phase 3. The table
 *    exists now so lessons can reference it from day one.
 *  - `courses` is the publishable unit; `slug` is unique per academy and is the last path segment on
 *    the learner site. Soft-deleted so history/enrollments outlive an editorial delete.
 *  - `course_sections` are ordered chapters; `lessons` are the items, a `type` selecting which
 *    payload column is meaningful (app-enforced, not a partial DB constraint — keeps the builder
 *    flexible). `quiz_id` is a bare uuid for now (no FK): quizzes are phase 4 and add the FK then.
 *  - `lesson_attachments` are downloadable extras on any lesson.
 *
 * Plain tenant tables: RLS tenant_isolation only (capability checks are the controller's job — same
 * split as crm_leads / whatsapp_api_keys). Every child row carries `academy_id` so the one policy
 * predicate scopes it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table media_assets (
              id                uuid primary key default uuid_generate_v7(),
              academy_id        uuid not null references academies(id) on delete cascade,
              kind              text not null check (kind in ('VIDEO','AUDIO')),
              original_filename text,
              storage_key       text,
              hls_manifest_key  text,
              playback_path     text,
              duration_seconds  int,
              size_bytes        bigint,
              status            text not null default 'PENDING'
                check (status in ('PENDING','UPLOADING','PROCESSING','READY','FAILED')),
              error             text,
              created_by        uuid,
              created_at        timestamptz not null default now(),
              updated_at        timestamptz not null default now()
            );
            create index media_assets_academy_status_idx on media_assets (academy_id, status);

            alter table media_assets enable row level security;
            alter table media_assets force row level security;
            create policy tenant_isolation on media_assets
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table courses (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id) on delete cascade,
              title            text not null,
              slug             text not null,
              subtitle         text,
              description      text,
              cover_image_path text,
              status           text not null default 'DRAFT'
                check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
              created_by       uuid,
              published_at     timestamptz,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now(),
              deleted_at       timestamptz,
              unique (academy_id, slug)
            );
            create index courses_academy_status_idx
              on courses (academy_id, status, created_at desc)
              where deleted_at is null;

            alter table courses enable row level security;
            alter table courses force row level security;
            create policy tenant_isolation on courses
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table course_sections (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              course_id   uuid not null references courses(id) on delete cascade,
              title       text not null,
              position    int not null default 0,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now()
            );
            create index course_sections_course_idx on course_sections (course_id, position);

            alter table course_sections enable row level security;
            alter table course_sections force row level security;
            create policy tenant_isolation on course_sections
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table lessons (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id) on delete cascade,
              course_id        uuid not null references courses(id) on delete cascade,
              section_id       uuid not null references course_sections(id) on delete cascade,
              title            text not null,
              type             text not null
                check (type in ('VIDEO_UPLOAD','YOUTUBE','AUDIO','PDF','TEXT','QUIZ')),
              position         int not null default 0,
              is_preview       boolean not null default false,
              duration_seconds int,
              media_asset_id   uuid references media_assets(id) on delete set null,
              youtube_video_id text,
              attachment_path  text,
              body             text,
              quiz_id          uuid,                 -- FK added with the quizzes table (phase 4)
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now()
            );
            create index lessons_course_section_idx on lessons (course_id, section_id, position);

            alter table lessons enable row level security;
            alter table lessons force row level security;
            create policy tenant_isolation on lessons
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            create table lesson_attachments (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id) on delete cascade,
              lesson_id   uuid not null references lessons(id) on delete cascade,
              title       text,
              file_path   text not null,
              size_bytes  bigint,
              created_at  timestamptz not null default now()
            );
            create index lesson_attachments_lesson_idx on lesson_attachments (lesson_id);

            alter table lesson_attachments enable row level security;
            alter table lesson_attachments force row level security;
            create policy tenant_isolation on lesson_attachments
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on lesson_attachments;
            drop table if exists lesson_attachments;
            drop policy if exists tenant_isolation on lessons;
            drop table if exists lessons;
            drop policy if exists tenant_isolation on course_sections;
            drop table if exists course_sections;
            drop policy if exists tenant_isolation on courses;
            drop table if exists courses;
            drop policy if exists tenant_isolation on media_assets;
            drop table if exists media_assets;
        SQL);
    }
};
