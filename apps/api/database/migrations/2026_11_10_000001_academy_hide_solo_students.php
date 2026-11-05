<?php

declare(strict_types=1);

use App\Http\Controllers\People\StudentController;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `hide_solo_students_from_parents`: a student on their own is not a family, so they stay off the
 * parents page (Alrayan, 2026-11-05). Their guardian row stays, because bills and receipts hang off
 * it ({@see StudentController::store}). Off by default and not on the
 * Controls tab, so no other academy sees any change; it is switched on per client.
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
        DB::unprepared('alter table academy_settings add column if not exists hide_solo_students_from_parents boolean not null default false;');

        $this->createReader(", 'hide_solo_students_from_parents', s0.hide_solo_students_from_parents");
    }

    public function down(): void
    {
        $this->createReader('');

        DB::unprepared('alter table academy_settings drop column if exists hide_solo_students_from_parents;');
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
                       'teacher_can_add_lessons', s0.teacher_can_add_lessons{$newKey})
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
