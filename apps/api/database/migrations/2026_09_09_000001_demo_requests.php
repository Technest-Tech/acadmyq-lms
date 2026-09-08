<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Demo requests — the marketing site's one conversion action.
 *
 * A visitor on acadmyq.com fills the form on `/contact` (or the inline one on a product page) and
 * lands here. This is the FIRST platform-level lead table: `crm_leads` is an academy's own sales
 * pipeline for its students, tenant-scoped and invisible across academies, so it cannot hold a
 * prospect who has no academy yet. Different owner, different audience, different lifecycle —
 * a separate table rather than a nullable `academy_id` bolted onto someone else's pipeline.
 *
 * PLATFORM-scoped, so no `academy_id` and no tenant policy. The RLS shape is the interesting part
 * and is deliberately asymmetric:
 *
 *   - INSERT `with check (true)` — the writer is an anonymous visitor with no tenant context at
 *     all. Abuse is bounded outside the database (per-IP throttle + honeypot in the controller),
 *     because there is nothing about a first-time prospect the database could authenticate.
 *   - SELECT/UPDATE/DELETE `app.is_super_admin()` — a lead carries a real person's phone and
 *     email. Only the platform team may ever read one back, and no academy context can reach it.
 *
 * There is no `returning` on the public insert, which is what keeps the write legal without a
 * select policy for the visitor.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table demo_requests (
              id          uuid primary key default uuid_generate_v7(),
              name        text not null,
              email       text,
              phone       text not null,
              -- ISO-3166-1 alpha-2, upper case. Free-form would make "مصر"/"Egypt"/"EG" three countries.
              country     text,
              -- Which product the prospect came for. UNDECIDED is a real answer, not a missing one:
              -- it is the single most useful routing signal the form collects.
              product     text not null,
              -- What they do today, in their own words ("مدرس لغة إنجليزية", "academy owner").
              role        text,
              message     text,
              -- Explicit, recorded consent to be contacted. Never defaulted true.
              consent     boolean not null,
              locale      text,
              -- The page the form was submitted from (/contact, /course-platform, …) — which
              -- campaign a lead came from is the difference between spending well and guessing.
              source      text,
              status      text not null default 'NEW',
              -- The platform team's own working note. Not the prospect's `message`.
              note        text,
              ip          text,
              user_agent  text,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              constraint demo_requests_product_chk
                check (product in ('COURSE_PLATFORM', 'ACADEMY_MANAGEMENT', 'UNDECIDED')),
              constraint demo_requests_status_chk
                check (status in ('NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST')),
              constraint demo_requests_consent_chk check (consent)
            );

            -- The queue is read newest-first, usually filtered to what has not been handled yet.
            create index demo_requests_created_idx on demo_requests (created_at desc);
            create index demo_requests_status_idx  on demo_requests (status, created_at desc);

            alter table demo_requests enable row level security;
            alter table demo_requests force row level security;

            create policy demo_requests_insert on demo_requests
              for insert with check (true);
            create policy demo_requests_select on demo_requests
              for select using (app.is_super_admin());
            create policy demo_requests_update on demo_requests
              for update using (app.is_super_admin()) with check (app.is_super_admin());
            create policy demo_requests_delete on demo_requests
              for delete using (app.is_super_admin());

            comment on table demo_requests is
              'Marketing-site demo requests (platform-scoped prospects). Distinct from crm_leads, which is an academy''s own student pipeline.';
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('drop table if exists demo_requests');
    }
};
