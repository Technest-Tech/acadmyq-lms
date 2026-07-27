<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The per-academy content of the LMS public course site (docs/lms/09). Every client's site is the
 * SAME template — same sections, same layout, same code — and this row is the only thing that
 * differs between them: brand, hero copy, about, instructors, FAQ, contact, SEO.
 *
 * One row per academy, one `content` JSONB blob, exactly like `certificate_templates`: the shape is
 * presentation text, it changes as the design changes, and pinning it to columns would mean a
 * migration for every new section. `App\Support\LmsSiteProfile` is the schema of record — it
 * declares the defaults, merges the stored blob over them and sanitises writes.
 *
 * Nothing here is required: an academy with NO row still gets a complete site, because the template
 * renders the defaults (derived from the academy's name, logo and catalogue). The row only ever
 * holds what the client actually changed.
 *
 * Carries `academy_id`, so it gets the standard tenant_isolation RLS policy (mirrors the block in
 * 2026_06_11_000010_rls_policies.php) — applied inline so migrate:fresh stays self-contained. That
 * one policy covers BOTH readers: staff editing under a normal tenant context, and the public
 * learner site, which runs inside the same academy context via ResolveAcademyContext.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table lms_site_profiles (
              id         uuid primary key default uuid_generate_v7(),
              academy_id uuid not null unique references academies(id),
              content    jsonb not null default '{}'::jsonb,
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now()
            );
            create index lms_site_profiles_academy_idx on lms_site_profiles (academy_id);

            alter table lms_site_profiles enable row level security;
            alter table lms_site_profiles force row level security;
            create policy tenant_isolation on lms_site_profiles
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on lms_site_profiles;
            drop table if exists lms_site_profiles;
        SQL);
    }
};
