<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A student can take two subjects with one teacher (lingo, 2026-11-03: Science and Maths with Omnia).
 * A subject stops being just its teacher: the open-block rule becomes one per (student, teacher,
 * course), and each timetable slot can name its subject, which its lessons keep. Nothing moves for
 * anyone with one subject per teacher: their slots and lessons stay null and the one block takes them.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table schedule_slots add column course text;
            alter table sessions add column course text;

            drop index if exists lesson_packages_one_active_per_scope;
            create unique index lesson_packages_one_active_per_subject
              on lesson_packages (student_id, teacher_id, lower(coalesce(course, '')))
              where status = 'ACTIVE' and teacher_id is not null;
            create unique index lesson_packages_one_active_untied
              on lesson_packages (student_id)
              where status = 'ACTIVE' and teacher_id is null;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists lesson_packages_one_active_per_subject;
            drop index if exists lesson_packages_one_active_untied;
            create unique index lesson_packages_one_active_per_scope
              on lesson_packages (student_id, coalesce(teacher_id, '00000000-0000-0000-0000-000000000000'::uuid))
              where status = 'ACTIVE';

            alter table sessions drop column if exists course;
            alter table schedule_slots drop column if exists course;
        SQL);
    }
};
