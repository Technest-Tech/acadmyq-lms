<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Admin panel — Phase 5 (billing & revenue overview).
 *
 * `app.admin_billing_overview()` — an audited SECURITY DEFINER read (same contract as
 * `app.admin_audit`) powering the Super Admin billing dashboard. It computes:
 *   - MRR grouped strictly BY CURRENCY (no FX — AC-8.9): each ACTIVE academy contributes its
 *     plan price and the price of each ACTIVE add-on, each into its own currency bucket.
 *   - academy counts by status.
 *   - a per-academy row (plan, active add-on total, monthly value, status, billing day).
 *
 * Read-only: there is no payment-provider integration yet (out of scope for this phase).
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

        // The definer reads the add-on ledger + catalog, which it has not been granted before.
        DB::unprepared("grant select on academy_addons, add_ons to {$bypass};");

        DB::unprepared('drop function if exists app.admin_billing_overview();');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_billing_overview()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_billing_overview requires SUPER_ADMIN';
              end if;

              with addon_sums as (
                select aa.academy_id,
                       count(*) filter (where aa.is_active)                       as active_addons,
                       coalesce(sum(ao.price_minor) filter (where aa.is_active), 0) as addons_total
                from academy_addons aa
                join add_ons ao on ao.id = aa.add_on_id
                group by aa.academy_id
              )
              select jsonb_build_object(
                'counts', jsonb_build_object(
                  'total',     (select count(*) from academies),
                  'active',    (select count(*) from academies where status = 'ACTIVE'),
                  'trial',     (select count(*) from academies where status = 'TRIAL'),
                  'suspended', (select count(*) from academies where status = 'SUSPENDED')
                ),
                'mrr', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'currency', g.currency, 'amount_minor', g.total
                  ) order by g.currency), '[]'::jsonb)
                  from (
                    select currency, sum(amount)::bigint as total
                    from (
                      select p.currency, p.price_minor::bigint as amount
                      from academies a
                      join plans p on p.id = a.plan_id
                      where a.status = 'ACTIVE'
                      union all
                      select ao.currency, ao.price_minor::bigint
                      from academies a
                      join academy_addons aa on aa.academy_id = a.id and aa.is_active
                      join add_ons ao on ao.id = aa.add_on_id
                      where a.status = 'ACTIVE'
                    ) comp
                    group by currency
                  ) g
                ),
                'academies', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'id', a.id,
                    'name', a.name,
                    'status', a.status,
                    'billing_day', a.billing_day,
                    'plan_code', p.code,
                    'plan_name', p.name,
                    'plan_price_minor', p.price_minor,
                    'currency', coalesce(p.currency, a.default_currency),
                    'active_addons', coalesce(s.active_addons, 0),
                    'addons_total_minor', coalesce(s.addons_total, 0),
                    'monthly_minor', coalesce(p.price_minor, 0) + coalesce(s.addons_total, 0)
                  ) order by a.name), '[]'::jsonb)
                  from academies a
                  left join plans p on p.id = a.plan_id
                  left join addon_sums s on s.academy_id = a.id
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_billing_overview() owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_billing_overview() from public;');
        DB::unprepared("grant execute on function app.admin_billing_overview() to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_billing_overview();');
    }
};
