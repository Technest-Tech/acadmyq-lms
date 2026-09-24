<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Academy controls (Settings → Controls): per-academy switches that turn system features on or
 * off for that academy's own users. One row per academy; a missing row means every default.
 *
 *   • teacher_lessons_read_only — teachers see their lessons but cannot add a class, mark
 *     attendance, write a report, reschedule, or raise a cancel/free request. Enforced by
 *     stripping those capabilities from the TEACHER set at request time (AcademySettings).
 *
 * The capability set is resolved in TenantContextMiddleware BEFORE the tenant GUCs exist, so the
 * RLS-protected table is read there through `app.auth_academy_settings(uuid)`, a BYPASSRLS
 * reader on the same pattern as `app.auth_academy_status`.
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
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        DB::unprepared(<<<'SQL'
            create table academy_settings (
              academy_id                uuid primary key references academies(id) on delete cascade,
              teacher_lessons_read_only boolean not null default false,
              created_at                timestamptz not null default now(),
              updated_at                timestamptz not null default now()
            );

            create trigger trg_set_updated_at before update on academy_settings
              for each row execute function set_updated_at();

            alter table academy_settings enable row level security;
            alter table academy_settings force row level security;
            create policy tenant_isolation on academy_settings
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        DB::unprepared("grant select on academy_settings to {$bypass};");

        // NULL when the academy has no row yet → callers fall back to the defaults.
        DB::unprepared(<<<'SQL'
            create or replace function app.auth_academy_settings(p_id uuid)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare s jsonb;
            begin
              select jsonb_build_object('teacher_lessons_read_only', s0.teacher_lessons_read_only)
                into s
                from academy_settings s0
               where s0.academy_id = p_id;
              return s;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.auth_academy_settings(uuid) owner to {$bypass};");
        DB::unprepared('revoke all on function app.auth_academy_settings(uuid) from public;');
        DB::unprepared("grant execute on function app.auth_academy_settings(uuid) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop function if exists app.auth_academy_settings(uuid);
            drop table if exists academy_settings;
        SQL);
    }
};
