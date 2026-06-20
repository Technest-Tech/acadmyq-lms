<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Cross-academy WhatsApp activity feed for the Super Admin automation console (Activity tab).
 * SECURITY DEFINER read (same contract as app.admin_automation_overview): re-asserts SUPER_ADMIN,
 * runs as the bypass role so it can read the tenant-scoped automation_send_log across academies.
 * automation_send_log + academies are already granted to the bypass role by the admin-overviews
 * migration, so no new table grants are required here.
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

        DB::unprepared('drop function if exists app.admin_whatsapp_activity(int);');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_whatsapp_activity(p_limit int default 50)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_whatsapp_activity requires SUPER_ADMIN';
              end if;

              select jsonb_build_object(
                'activity', (
                  select coalesce(jsonb_agg(row), '[]'::jsonb) from (
                    select jsonb_build_object(
                      'id',              l.id,
                      'academy_id',      l.academy_id,
                      'academy_name',    a.name,
                      'automation_type', l.automation_type,
                      'transport',       l.transport,
                      'recipient_kind',  l.recipient_kind,
                      'recipient_phone', l.recipient_phone,
                      'status',          l.status,
                      'error',           l.error,
                      'created_at',      l.created_at
                    ) as row
                    from automation_send_log l
                    join academies a on a.id = l.academy_id
                    order by l.created_at desc
                    limit greatest(1, least(p_limit, 200))
                  ) rows
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_whatsapp_activity(int) owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_whatsapp_activity(int) from public;');
        DB::unprepared("grant execute on function app.admin_whatsapp_activity(int) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_whatsapp_activity(int);');
    }
};
