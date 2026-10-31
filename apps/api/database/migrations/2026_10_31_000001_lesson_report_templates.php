<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Structured lesson reports (the `lesson_report` capability): the academy's report fields become
 * the form a teacher or supervisor fills after a lesson, and the academy writes the WhatsApp
 * message those values are poured into.
 *
 *   - `report_field_definitions.section`   — the heading a field sits under on the form
 *                                            ("التقييم", "الواجب القادم"). Free text, nullable.
 *   - `report_field_definitions.max_value` — a NUMBER field with a max is a score "out of" it,
 *                                            rendered "9 / 10". Kept off the `report_field_type`
 *                                            enum on purpose: a new enum value cannot be dropped
 *                                            again, a nullable column can.
 *   - `lesson_report_templates`            — one message per academy, `{placeholder}` text.
 *
 * Carries `academy_id`, so it gets the same standard tenant_isolation RLS policy as every other
 * tenant table — applied inline here so migrate:fresh stays self-contained.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table report_field_definitions
              add column if not exists section text,
              add column if not exists max_value int
                constraint report_field_max_value_chk check (max_value is null or max_value between 1 and 1000);

            create table lesson_report_templates (
              id         uuid primary key default uuid_generate_v7(),
              academy_id uuid not null references academies(id),
              message    text not null default '',
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now(),
              unique (academy_id)
            );

            alter table lesson_report_templates enable row level security;
            alter table lesson_report_templates force row level security;
            create policy tenant_isolation on lesson_report_templates
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on lesson_report_templates;
            drop table if exists lesson_report_templates;
            alter table report_field_definitions
              drop column if exists max_value,
              drop column if exists section;
        SQL);
    }
};
