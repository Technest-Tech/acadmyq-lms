<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Add `api_key_count` (live, non-revoked keys) to app.admin_automation_overview() so the Super-Admin
 * "API Clients" tab can show, per academy, how many external API keys are active. Read-only,
 * backward-compatible addition to the existing SECURITY DEFINER reader (2026_06_26_000007). The app
 * role is a member of the owning BYPASSRLS role (it performed the original owner transfer), so it may
 * replace the function; we re-assert owner + grants to be safe.
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
        $this->define(withKeyCount: true);
    }

    public function down(): void
    {
        $this->define(withKeyCount: false);
    }

    private function define(bool $withKeyCount): void
    {
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        $keyCte = $withKeyCount
            ? 'keycounts as (
                 select academy_id, count(*) as api_key_count
                 from whatsapp_api_keys
                 where revoked_at is null
                 group by academy_id
               ),'
            : '';
        $keyField = $withKeyCount ? "'api_key_count', coalesce(kc.api_key_count, 0)," : '';
        $keyJoin = $withKeyCount ? 'left join keycounts kc on kc.academy_id = a.id' : '';

        DB::unprepared(<<<SQL
            create or replace function app.admin_automation_overview()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as \$\$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_automation_overview requires SUPER_ADMIN';
              end if;

              with {$keyCte} sendcounts as (
                select academy_id,
                       count(*) filter (where status = 'SENT')    as sent_count,
                       count(*) filter (where status = 'FAILED')  as failed_count,
                       count(*) filter (where status = 'SKIPPED') as skipped_count
                from automation_send_log
                where created_at > now() - interval '30 days'
                group by academy_id
              )
              select jsonb_build_object(
                'academies', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'academy_id',              a.id,
                    'academy_name',            a.name,
                    'academy_status',          a.status,
                    'type1_billing_enabled',   coalesce(s.type1_billing_enabled, false),
                    'type2_lessons_enabled',   coalesce(s.type2_lessons_enabled, false),
                    'has_token',               (s.wasender_token is not null),
                    'wasender_session_status', s.wasender_session_status,
                    {$keyField}
                    'sent_count',              coalesce(sc.sent_count, 0),
                    'failed_count',            coalesce(sc.failed_count, 0),
                    'skipped_count',           coalesce(sc.skipped_count, 0)
                  ) order by a.name), '[]'::jsonb)
                  from academies a
                  left join academy_automation_settings s on s.academy_id = a.id
                  left join sendcounts sc on sc.academy_id = a.id
                  {$keyJoin}
                )
              )
              into result;

              return result;
            end;
            \$\$;
        SQL);

        DB::unprepared("alter function app.admin_automation_overview() owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_automation_overview() from public;');
        DB::unprepared("grant execute on function app.admin_automation_overview() to {$app};");
    }
};
