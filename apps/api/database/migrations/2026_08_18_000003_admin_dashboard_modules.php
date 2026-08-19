<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * docs/superadmin-modules/05-MODULES-NOT-PACKAGES — the platform overview counted academies per
 * PLAN, which now means nothing. It counts clients per MODULE (who holds what) and per TYPE (what
 * kind of client they are) instead. Function body only; the rest of admin_dashboard_stats is
 * unchanged from 2026_06_21_000001.
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
                'module_distribution', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'module',       m.module,
                    'client_count', m.n,
                    'trial_count',  m.t
                  ) order by m.n desc, m.module), '[]'::jsonb)
                  from (
                    select ms.module,
                           count(*) as n,
                           count(*) filter (where ms.is_trial) as t
                    from module_subscriptions ms
                    where ms.status <> 'ENDED'
                    group by ms.module
                  ) m
                ),
                'type_distribution', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'client_type',  ty.client_type,
                    'client_count', ty.n
                  ) order by ty.n desc, ty.client_type), '[]'::jsonb)
                  from (
                    select a.client_type, count(*) as n from academies a group by a.client_type
                  ) ty
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
        // The previous body belongs to 2026_06_21_000001 — re-run that migration to restore it.
    }
};
