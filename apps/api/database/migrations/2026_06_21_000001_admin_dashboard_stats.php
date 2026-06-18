<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Admin panel — Phase 1 (platform dashboard).
 *
 * `app.admin_dashboard_stats()` — the audited cross-tenant read powering the Super Admin
 * landing dashboard. It follows the `app.admin_list_academies()` / `app.admin_audit()`
 * escape-hatch contract exactly: SECURITY DEFINER (so it bypasses RLS), owned by the bypass
 * role, with a SUPER_ADMIN guard in the body and a curated, aggregate-only projection (never
 * a raw row dump). It returns a single jsonb object with platform counts so the dashboard
 * renders from one round-trip; recent activity is read separately via app.admin_audit().
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

        // The bypass role already holds SELECT on academies, students, teachers, guardians
        // and plans (granted by the RLS-policy and academy-type migrations), which is every
        // table this aggregate touches — no new table grant is required.
        DB::unprepared('drop function if exists app.admin_dashboard_stats();');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_dashboard_stats()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_dashboard_stats requires SUPER_ADMIN';
              end if;

              select jsonb_build_object(
                'academies', jsonb_build_object(
                  'total',     (select count(*) from academies),
                  'active',    (select count(*) from academies where status = 'ACTIVE'),
                  'trial',     (select count(*) from academies where status = 'TRIAL'),
                  'suspended', (select count(*) from academies where status = 'SUSPENDED'),
                  'recent',    (select count(*) from academies where created_at >= now() - interval '30 days')
                ),
                'people', jsonb_build_object(
                  'students',  (select count(*) from students),
                  'teachers',  (select count(*) from teachers),
                  'guardians', (select count(*) from guardians)
                ),
                'plan_distribution', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'plan_id',       p.id,
                    'plan_code',     p.code,
                    'plan_name',     p.name,
                    'academy_count', (select count(*) from academies a where a.plan_id = p.id)
                  ) order by p.name), '[]'::jsonb)
                  from plans p
                  where p.is_active
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_dashboard_stats() owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_dashboard_stats() from public;');
        DB::unprepared("grant execute on function app.admin_dashboard_stats() to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_dashboard_stats();');
    }
};
