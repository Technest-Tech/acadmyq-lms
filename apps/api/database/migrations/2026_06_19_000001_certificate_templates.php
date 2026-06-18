<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-academy certificate templates (Certificates feature). Each academy owns exactly two
 * templates — `template_number` 1 ("Royal Gold") and 2 ("Geometric Mosaic") — whose editable
 * presentation text (titles, body, signatory, accent colour, …) lives in a single `content`
 * JSONB blob. The visual design itself lives in the web client; this row only persists the
 * academy's wording/branding so it survives across devices and sessions.
 *
 * Carries `academy_id`, so it gets the SAME standard tenant_isolation RLS policy as every
 * other tenant table (mirrors the block in 2026_06_11_000010_rls_policies.php) — applied
 * inline here so migrate:fresh stays self-contained.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table certificate_templates (
              id              uuid primary key default uuid_generate_v7(),
              academy_id      uuid not null references academies(id),
              template_number smallint not null check (template_number in (1, 2)),
              content         jsonb not null default '{}'::jsonb,
              created_at      timestamptz not null default now(),
              updated_at      timestamptz not null default now(),
              unique (academy_id, template_number)
            );
            create index certificate_templates_academy_idx on certificate_templates (academy_id);

            alter table certificate_templates enable row level security;
            alter table certificate_templates force row level security;
            create policy tenant_isolation on certificate_templates
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on certificate_templates;
            drop table if exists certificate_templates;
        SQL);
    }
};
