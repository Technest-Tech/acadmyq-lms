<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 4 §7 — small, additive refinements on top of the Sprint 1 people tables:
 *
 *  - `teachers.availability jsonb` — the weekly windows a teacher can teach
 *    `[{weekday, start_local, end_local}]`; guidance consumed by Sprint 5 scheduling (R-PAY).
 *  - `students.is_self_guardian boolean` — marks the adult-solo case (R-STU-2) so the UI can
 *    hide the separate guardian section; the student still points at a real guardian row.
 *  - `guardians.notes` / `students.notes text` — operational notes (never the session report).
 *  - E.164 format checks on every phone column so Sprint 6/10 messaging and Sprint 7 invoice
 *    links are reliable (decision §3.7); the controllers also normalise on write.
 *  - Confirm the one-active-teacher-per-student partial unique index exists (Sprint 1 AC-1.9);
 *    `if not exists` makes this a no-op when Sprint 1 already created it.
 *
 * All raw DDL (DB::unprepared) because Postgres CHECK constraints and partial indexes have no
 * first-class Blueprint API, matching the Sprint 1/3 migration style.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table teachers
              add column availability jsonb not null default '[]'::jsonb;

            alter table students
              add column is_self_guardian boolean not null default false,
              add column notes            text;

            alter table guardians
              add column notes text;

            -- E.164: a leading '+' then 1..15 digits, first digit non-zero. Nullable phones
            -- (students.whatsapp_phone, teachers.phone) only constrained when present.
            alter table guardians
              add constraint guardians_whatsapp_e164_chk
              check (whatsapp_phone ~ '^\+[1-9][0-9]{1,14}$');

            alter table students
              add constraint students_whatsapp_e164_chk
              check (whatsapp_phone is null or whatsapp_phone ~ '^\+[1-9][0-9]{1,14}$');

            alter table teachers
              add constraint teachers_phone_e164_chk
              check (phone is null or phone ~ '^\+[1-9][0-9]{1,14}$');

            -- Backstop for one active teacher per student (R-STU-3). No-op if Sprint 1 made it.
            create unique index if not exists sta_one_active_per_student
              on student_teacher_assignments (student_id)
              where ended_at is null;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table teachers  drop constraint if exists teachers_phone_e164_chk;
            alter table students  drop constraint if exists students_whatsapp_e164_chk;
            alter table guardians drop constraint if exists guardians_whatsapp_e164_chk;

            alter table guardians drop column if exists notes;
            alter table students  drop column if exists notes;
            alter table students  drop column if exists is_self_guardian;
            alter table teachers  drop column if exists availability;
        SQL);
        // The partial index predates this migration (Sprint 1) — leave it in place.
    }
};
