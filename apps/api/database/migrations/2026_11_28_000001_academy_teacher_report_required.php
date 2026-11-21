<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `teacher_report_required` (Settings → Controls): a teacher cannot record a lesson as delivered
 * until its report is written (2026-11-21). Off by default, so no academy sees a change until it
 * switches it on; a centre that never writes reports is never caught by it.
 *
 * `app.auth_academy_settings(uuid)` is re-created to return the new key.
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
        DB::unprepared('alter table academy_settings add column if not exists teacher_report_required boolean not null default false;');

        $this->createReader(", 'teacher_report_required', s0.teacher_report_required");
    }

    public function down(): void
    {
        $this->createReader('');

        DB::unprepared('alter table academy_settings drop column if exists teacher_report_required;');
    }

    private function createReader(string $newKey): void
    {
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // NULL when the academy has no row yet → callers fall back to the defaults.
        DB::unprepared(<<<SQL
            create or replace function app.auth_academy_settings(p_id uuid)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as \$\$
            declare s jsonb;
            begin
              select jsonb_build_object(
                       'teacher_lessons_read_only', s0.teacher_lessons_read_only,
                       'teacher_can_reschedule', s0.teacher_can_reschedule,
                       'teacher_can_add_lessons', s0.teacher_can_add_lessons,
                       'hide_solo_students_from_parents', s0.hide_solo_students_from_parents{$newKey})
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
