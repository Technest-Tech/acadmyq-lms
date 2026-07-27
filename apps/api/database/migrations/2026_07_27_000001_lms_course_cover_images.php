<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Course cover images (docs/lms/04 §media). `courses.cover_image_path` has existed since phase 1 and
 * the whole learner site already renders it — but nothing could ever SET it, because the upload
 * pipeline only admitted VIDEO and AUDIO. Widening the `media_assets.kind` check lets a cover go
 * through the same reserve → PUT → confirm flow as lesson media (cap enforcement included).
 *
 * The column stays `text`: it holds either an `lms/…` storage key (an uploaded cover, resolved to a
 * signed URL on read) or a plain http(s) URL, so anything already stored keeps working.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table media_assets drop constraint if exists media_assets_kind_check;
            alter table media_assets
              add constraint media_assets_kind_check check (kind in ('VIDEO','AUDIO','IMAGE'));
        SQL);
    }

    public function down(): void
    {
        // Covers become unreferenced rather than blocking the rollback on a surviving IMAGE row.
        DB::unprepared(<<<'SQL'
            update courses set cover_image_path = null
              where cover_image_path like 'lms/%';
            delete from media_assets where kind = 'IMAGE';
            alter table media_assets drop constraint if exists media_assets_kind_check;
            alter table media_assets
              add constraint media_assets_kind_check check (kind in ('VIDEO','AUDIO'));
        SQL);
    }
};
