<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A student taken off ONE group lesson (docs/groups/00-OVERVIEW.md, "Removing a student from one
 * lesson"). The roster is the memberships covering the lesson's date, so deleting an attendance row
 * alone would only bring the student back on the next open: the removal has to be remembered. A
 * removed student is not expected, not marked, not charged, not paid for and uses none of their
 * hours on that lesson. Reverting the sheet clears the lesson's removals with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table class_group_lesson_removals (
              id         uuid primary key default uuid_generate_v7(),
              academy_id uuid not null references academies(id),
              lesson_id  uuid not null references class_group_lessons(id) on delete cascade,
              group_id   uuid not null references class_groups(id) on delete cascade,
              student_id uuid not null references students(id),
              removed_by uuid references users(id),
              created_at timestamptz not null default now(),
              unique (lesson_id, student_id)
            );
            create index class_group_lesson_removals_group_idx on class_group_lesson_removals (group_id);

            alter table class_group_lesson_removals enable row level security;
            alter table class_group_lesson_removals force row level security;
            create policy tenant_isolation on class_group_lesson_removals
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('drop table if exists class_group_lesson_removals;');
    }
};
