<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The clients hub learns whether a client is actually using the system (Ahmed, 2026-11-07): the
 * signals that warn of a cancellation before it happens.
 *
 *  - `owner_name` / `owner_phone`: who to call, now that creation asks for both.
 *  - `last_login_at`: the latest `auth.login` anyone at the academy made (the audit log already
 *    records every sign-in, so nothing new is written).
 *  - `lessons_this_month`: lessons recorded (attended or marked absent) since the 1st of the month
 *    in the academy's own timezone; a hidden (deleted) lesson does not count.
 *  (What the client owes us is NOT here: it comes from the accounts book — FinanceLedger — and
 *  ClientController merges it in, see 2026_11_14_000001_accounts_unify.)
 *
 * Function body only — no table DDL, so nothing here can poison a re-run (M-PROC-2). Every table it
 * reads is already granted to the bypass role (audit_log, sessions).
 */
return new class extends Migration
{
    public function up(): void
    {
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
                    'id',                 a.id,
                    'name',               a.name,
                    'client_type',        a.client_type,
                    'status',             a.status,
                    'suspended_reason',   a.suspended_reason,
                    'default_currency',   a.default_currency,
                    'timezone',           a.timezone,
                    'subdomain',          a.subdomain,
                    'created_at',         a.created_at,
                    'owner_email',        ow.email,
                    'owner_name',         ow.full_name,
                    'owner_phone',        ow.phone,
                    'student_count',      coalesce(st.n, 0),
                    'teacher_count',      coalesce(te.n, 0),
                    'last_login_at',      li.at,
                    'lessons_this_month', coalesce(le.n, 0),
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
                        'base_price_minor',    ms.base_price_minor,
                        'total_cost_minor',    ms.total_cost_minor,
                        'currency',            ms.currency,
                        'overrides',           ms.overrides
                      ) order by ms.module), '[]'::jsonb)
                      from module_subscriptions ms
                      left join plans p on p.id = ms.plan_id
                      where ms.academy_id = a.id and ms.status <> 'ENDED'
                    )
                  ) order by a.name), '[]'::jsonb)
                  from academies a
                  left join lateral (
                    select u.email, u.full_name, u.phone from users u
                    join user_roles ur on ur.user_id = u.id and ur.role = 'ACADEMY_OWNER'
                    where u.academy_id = a.id
                    order by u.created_at limit 1
                  ) ow on true
                  left join lateral (select count(*) as n from students s where s.academy_id = a.id) st on true
                  left join lateral (select count(*) as n from teachers t where t.academy_id = a.id) te on true
                  left join lateral (
                    select max(al.created_at) as at from audit_log al
                    where al.academy_id = a.id and al.action = 'auth.login'
                  ) li on true
                  left join lateral (
                    select count(*) as n from sessions se
                    where se.academy_id = a.id
                      and se.hidden_at is null
                      and se.status in ('ATTENDED', 'ABSENT_EXCUSED', 'ABSENT_UNEXCUSED')
                      and se.scheduled_at_utc >= (date_trunc('month', now() at time zone a.timezone) at time zone a.timezone)
                  ) le on true
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);
    }

    public function down(): void
    {
        // Intentionally empty: a `create or replace` body owned by earlier migrations — rolling back
        // to its previous definition means re-running 2026_08_18_000002, and dropping the function
        // here would leave the panel blind on a partial rollback.
    }
};
