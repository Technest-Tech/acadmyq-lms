<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The course site's blog (docs/lms/12). A course-platform client writes articles in the dashboard
 * and they appear on their public site under `/blog` — the content-marketing half of selling
 * courses: a search engine finds an article long before it finds a course page.
 *
 * Shaped like `digital_products` where the rules are the same (slug unique per academy, soft
 * delete, a status the storefront filters on) and nowhere else. There is no price and no
 * entitlement: a post is public the moment it is PUBLISHED.
 *
 * `content_html` is ALWAYS sanitized before it is written (App\Support\Lms\BlogContent) — the
 * column holds a stored form, not what the browser sent: uploaded images are kept as a media-asset
 * id and re-signed on every read, and a YouTube embed is kept as its video id and re-expanded, so
 * nothing in the row can expire or point at a host we did not choose.
 *
 * Tenant-scoped with the standard FORCE-RLS `tenant_isolation` policy: staff write it under their
 * tenant context, the public site reads it under ResolveAcademyContext, both the same academy.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table blog_posts (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id) on delete cascade,
              title            text not null,
              slug             text not null,
              -- The author's own summary. Optional: `auto_excerpt` is derived from the body on
              -- every save and is what the card and the meta description fall back to.
              excerpt          text,
              auto_excerpt     text,
              content_html     text not null default '',
              cover_image_path text,
              author_name      text,
              reading_minutes  int not null default 1 check (reading_minutes > 0),
              status           text not null default 'DRAFT'
                check (status in ('DRAFT','PUBLISHED')),
              created_by       uuid,
              published_at     timestamptz,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now(),
              deleted_at       timestamptz,
              unique (academy_id, slug)
            );
            create index blog_posts_academy_status_idx
              on blog_posts (academy_id, status, published_at desc)
              where deleted_at is null;

            alter table blog_posts enable row level security;
            alter table blog_posts force row level security;
            create policy tenant_isolation on blog_posts
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            comment on column blog_posts.content_html is
              'Sanitized stored form (docs/lms/12 §3): images as data-media-id, YouTube as data-youtube-video="<id>". Render with BlogContent::render.';
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('drop table if exists blog_posts;');
    }
};
