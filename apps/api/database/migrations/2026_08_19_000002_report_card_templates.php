<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The per-academy REPORT CARD template — the wording behind the shareable session/trial report
 * image the academy sends the guardian.
 *
 * A session report is two different things at once. The *facts* (which surah, which rating, the
 * teacher's note) are per-session and already live in `session_reports` against the academy's
 * `report_field_definitions`. The *voice* — the headline, the note to the child, the du'a, the
 * closing tagline — is the same every single time and belongs to the ACADEMY, not the lesson.
 * Typing it into every report is how academies end up with fifteen slightly different versions of
 * their own brand. So it is written once here and poured into every card.
 *
 * One row per academy (no template_number): there is a single flagship card design, and the design
 * itself lives in the web client — this row only persists the editable text and accent colour so it
 * survives across devices and staff. Same shape and reasoning as `certificate_templates`.
 *
 * Carries `academy_id`, so it gets the SAME standard tenant_isolation RLS policy as every other
 * tenant table — applied inline here so migrate:fresh stays self-contained.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table report_card_templates (
              id         uuid primary key default uuid_generate_v7(),
              academy_id uuid not null references academies(id),
              content    jsonb not null default '{}'::jsonb,
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now(),
              unique (academy_id)
            );
            create index report_card_templates_academy_idx on report_card_templates (academy_id);

            alter table report_card_templates enable row level security;
            alter table report_card_templates force row level security;
            create policy tenant_isolation on report_card_templates
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on report_card_templates;
            drop table if exists report_card_templates;
        SQL);
    }
};
