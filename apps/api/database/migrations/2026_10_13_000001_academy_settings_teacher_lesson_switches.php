<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two more academy controls (Settings → Controls), finer-grained than "read-only lessons":
 *
 *   • teacher_can_reschedule  — the Reschedule action on the teacher's attendance page.
 *   • teacher_can_add_lessons — the "Add class" button (a one-off lesson the timetable never made).
 *
 * Both default to TRUE — that is what a teacher could already do — so existing academies see no
 * change until they switch one off. Enforced like the first switch: AcademySettings strips
 * `session.reschedule` / `session.create` from the TEACHER set at request time.
 *
 * `app.auth_academy_settings(uuid)` is re-created to return the new keys.
 */
return new class extends Migration
{
    private function role(string $key): string
    {
        $role = (string) config("database.rls.{$key}");
        if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $role)) {
            throw new RuntimeException("Invalid RLS role identifier for {$key}: {$role}");
        }

        return $role;
    }

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academy_settings
              add column teacher_can_reschedule  boolean not null default true,
              add column teacher_can_add_lessons boolean not null default true;
        SQL);

        $this->createReader(withNewKeys: true);
    }

    public function down(): void
    {
        $this->createReader(withNewKeys: false);

        DB::unprepared(<<<'SQL'
            alter table academy_settings
              drop column if exists teacher_can_reschedule,
              drop column if exists teacher_can_add_lessons;
        SQL);
    }

    private function createReader(bool $withNewKeys): void
    {
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        $extra = $withNewKeys
            ? ", 'teacher_can_reschedule', s0.teacher_can_reschedule, 'teacher_can_add_lessons', s0.teacher_can_add_lessons"
            : '';

        // NULL when the academy has no row yet → callers fall back to the defaults.
        DB::unprepared(<<<SQL
            create or replace function app.auth_academy_settings(p_id uuid)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as \$\$
            declare s jsonb;
            begin
              select jsonb_build_object('teacher_lessons_read_only', s0.teacher_lessons_read_only{$extra})
                into s
                from academy_settings s0
               where s0.academy_id = p_id;
              return s;
            end;
            \$\$;
        SQL);

        DB::unprepared("alter function app.auth_academy_settings(uuid) owner to {$bypass};");
        DB::unprepared('revoke all on function app.auth_academy_settings(uuid) from public;');
        DB::unprepared("grant execute on function app.auth_academy_settings(uuid) to {$app};");
    }
};
