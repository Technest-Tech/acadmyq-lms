<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The videos behind the in-app help (Ahmed, 2026-11-15: clients and their staff do not understand
 * the system; every page gets a "?" with short steps and a one-minute video he records himself).
 *
 * The help TEXT ships with the web app (apps/web/src/content/help); only the videos live here, so he
 * can record one today and attach it without a deploy. One row per SLOT — the web's name for a place
 * a video can play ("students" = the page tour, "students.add" = one task). A slot with no row is a
 * video not recorded yet: the panel shows its "coming soon" card and nothing breaks.
 *
 * A video is either a LINK (YouTube / Vimeo / a direct file url) or an UPLOAD on the media disk
 * (`help/videos/…`, the LMS's own disk and presigned-PUT plumbing — App\Support\LmsMedia).
 *
 * Platform-level, like `plans` and `feature_flags`: every signed-in user of every client reads it,
 * only a Super Admin writes it. Re-runnable (M-PROC-2).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists help_videos (
              slot              text primary key,
              source            text not null,
              url               text,
              storage_key       text,
              original_filename text,
              size_bytes        bigint,
              updated_by        uuid references users(id) on delete set null,
              created_at        timestamptz not null default now(),
              updated_at        timestamptz not null default now(),
              constraint help_videos_slot_chk   check (slot ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
              constraint help_videos_source_chk check (source in ('LINK','UPLOAD')),
              constraint help_videos_target_chk check (
                (source = 'LINK'   and url is not null         and storage_key is null) or
                (source = 'UPLOAD' and storage_key is not null and url is null)
              )
            );

            -- Shared-read catalog, Super-Admin write (identical to plans / feature_flags).
            alter table help_videos enable row level security;
            alter table help_videos force row level security;
            drop policy if exists catalog_select on help_videos;
            create policy catalog_select on help_videos for select using (true);
            drop policy if exists catalog_mutate on help_videos;
            create policy catalog_mutate on help_videos for all
              using (app.is_super_admin()) with check (app.is_super_admin());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists help_videos;
        SQL);
    }
};
