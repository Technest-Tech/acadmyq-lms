<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * R1 (docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN §5.3) — the client directory read behind
 * GET /admin/clients: every client (academies row) with its per-module subscription summary
 * (module, status, trial window, plan, price), owner email and headcounts, in one audited
 * SECURITY DEFINER read — same contract as app.admin_subscription_overview (re-asserts
 * SUPER_ADMIN, runs as the bypass role, RLS untouched for everyone else).
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

        // module_subscriptions postdates the 2026_06_26 grants; the rest are idempotent re-grants.
        DB::unprepared("grant select on module_subscriptions, plans, academies, users, user_roles, students, teachers to {$bypass};");

        DB::unprepared('drop function if exists app.admin_client_directory();');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_client_directory()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_client_directory requires SUPER_ADMIN';
              end if;

              select jsonb_build_object(
                'clients', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'id',               a.id,
                    'name',             a.name,
                    'status',           a.status,
                    'suspended_reason', a.suspended_reason,
                    'default_currency', a.default_currency,
                    'timezone',         a.timezone,
                    'subdomain',        a.subdomain,
                    'created_at',       a.created_at,
                    'owner_email',      ow.email,
                    'student_count',    coalesce(st.n, 0),
                    'teacher_count',    coalesce(te.n, 0),
                    'modules', (
                      select coalesce(jsonb_agg(jsonb_build_object(
                        'module',              ms.module,
                        'status',              ms.status,
                        'is_trial',            ms.is_trial,
                        'trial_end',           ms.trial_end,
                        'plan_id',             ms.plan_id,
                        'plan_code',           p.code,
                        'plan_name',           p.name,
                        'billing_interval',    ms.billing_interval,
                        'current_period_end',  ms.current_period_end,
                        'total_cost_minor',    ms.total_cost_minor,
                        'currency',            ms.currency
                      ) order by ms.module), '[]'::jsonb)
                      from module_subscriptions ms
                      left join plans p on p.id = ms.plan_id
                      where ms.academy_id = a.id and ms.status <> 'ENDED'
                    )
                  ) order by a.name), '[]'::jsonb)
                  from academies a
                  left join lateral (
                    select u.email from users u
                    join user_roles ur on ur.user_id = u.id and ur.role = 'ACADEMY_OWNER'
                    where u.academy_id = a.id
                    order by u.created_at limit 1
                  ) ow on true
                  left join lateral (select count(*) as n from students s where s.academy_id = a.id) st on true
                  left join lateral (select count(*) as n from teachers t where t.academy_id = a.id) te on true
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_client_directory() owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_client_directory() from public;');
        DB::unprepared("grant execute on function app.admin_client_directory() to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_client_directory();');
    }
};
