<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Several private subscriptions per student, one per subject (a group centre, 2026-10-26): a student
 * takes Maths with one teacher and English with another and pays for each block separately.
 *
 *   teacher_id  the subject's teacher (`student_teacher_assignments`). A lesson draws from the
 *               package of its timetable's teacher, else from an untied one (null — every package
 *               before this, and every Quran academy's: "any of the student's lessons").
 *   course      the subject's name as it was when the block was sold, for display.
 *
 * The one-open-package-per-student rule becomes one open package per (student, subject teacher):
 * the untied scope is still at most one, so an academy that never ties a package reads exactly as
 * before. Relaxing a unique index touches no data; rolling back recreates the old index (refused
 * while a student holds two open tied blocks — close one first).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table lesson_packages
              add column teacher_id uuid references teachers(id),
              add column course text;

            drop index if exists lesson_packages_one_active_per_student;
            create unique index lesson_packages_one_active_per_scope
              on lesson_packages (student_id, coalesce(teacher_id, '00000000-0000-0000-0000-000000000000'::uuid))
              where status = 'ACTIVE';
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists lesson_packages_one_active_per_scope;
            create unique index lesson_packages_one_active_per_student
              on lesson_packages (student_id) where status = 'ACTIVE';
            alter table lesson_packages drop column if exists course, drop column if exists teacher_id;
        SQL);
    }
};
