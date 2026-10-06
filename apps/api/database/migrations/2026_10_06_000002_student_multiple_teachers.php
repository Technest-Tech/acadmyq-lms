<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A student may study with several teachers at once — Qur'an with one, Arabic with another — so
 * the "exactly one active teacher per student" rule (R-STU-3, Sprint 1) becomes "each teacher at
 * most once per student", and every link carries the course it is for.
 *
 *  - `student_teacher_assignments.course` — free text ("Qur'an", "Tajweed"). Optional.
 *  - `sta_one_active_per_student` is replaced by `sta_one_active_per_pair`. History stays a
 *    close+open trail per pair, exactly as before.
 *  - The TIMETABLE's own `teacher_id` becomes the authority for whose lessons it generates. Until
 *    now the generator ignored it and used the student's single active assignment, so a stale
 *    `schedules.teacher_id` was harmless; it is not any more. Each active timetable is therefore
 *    re-pointed at the teacher the generator was already using, which changes no lesson.
 *  - A live timetable whose student has NO active teacher (the generator fell back to the
 *    timetable's teacher) gets that teacher linked, so "who teaches this student" and "who gets
 *    their lessons" agree from day one.
 *
 * Every tenant table is under FORCE row-level security, so the data steps run academy by academy
 * with the tenant GUC set (the pattern of 2026_09_30_000001_normalize_teacher_availability).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table student_teacher_assignments add column if not exists course text;

            drop index if exists sta_one_active_per_student;
            create unique index if not exists sta_one_active_per_pair
              on student_teacher_assignments (student_id, teacher_id)
              where ended_at is null;
        SQL);

        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

            // Under the old rule there is at most one active assignment per student, so this join
            // is one-to-one.
            DB::statement(<<<'SQL'
                update schedules s
                   set teacher_id = a.teacher_id, updated_at = now()
                  from student_teacher_assignments a
                 where a.student_id = s.student_id
                   and a.ended_at is null
                   and s.is_active
                   and s.deleted_at is null
                   and s.teacher_id <> a.teacher_id
            SQL);

            DB::statement(<<<'SQL'
                insert into student_teacher_assignments (academy_id, student_id, teacher_id, started_at)
                select distinct on (s.student_id, s.teacher_id) s.academy_id, s.student_id, s.teacher_id, now()
                  from schedules s
                  join students st on st.id = s.student_id and st.deleted_at is null
                  join teachers t on t.id = s.teacher_id and t.deleted_at is null
                 where s.is_active
                   and s.deleted_at is null
                   and not exists (
                         select 1 from student_teacher_assignments a
                          where a.student_id = s.student_id and a.ended_at is null
                       )
            SQL);
        }

        DB::statement("select set_config('app.current_academy_id', '', true)");
    }

    public function down(): void
    {
        // Restoring the single-teacher index fails while any student still has two active
        // teachers — deliberately: rolling back must not silently pick which one to drop.
        DB::unprepared(<<<'SQL'
            drop index if exists sta_one_active_per_pair;
            create unique index if not exists sta_one_active_per_student
              on student_teacher_assignments (student_id)
              where ended_at is null;
            alter table student_teacher_assignments drop column if exists course;
        SQL);
    }
};
