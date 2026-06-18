<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Cross-academy Super Admin overviews for the new sidebar pages (Platform↔Academy billing +
 * automation). Two SECURITY DEFINER reads, same contract as app.admin_billing_overview:
 *
 *   • app.admin_subscription_overview() — every academy's subscription (plan, trial, total cost),
 *     its outstanding platform bills, and the global pending payment-proof review queue.
 *   • app.admin_automation_overview() — every academy's WhatsApp automation status (toggles,
 *     whether a token is set — NEVER the token, session status) + recent send-log counts.
 *
 * Both re-assert SUPER_ADMIN internally and run as the bypass role so they can read tenant-scoped
 * tables across academies without a tenant context.
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

        // The definers read these tenant tables across academies — grant the bypass role SELECT.
        DB::unprepared("grant select on academy_subscriptions, academy_invoices, academy_payment_submissions, academy_automation_settings, automation_send_log, plans, academies to {$bypass};");

        DB::unprepared('drop function if exists app.admin_subscription_overview();');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_subscription_overview()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_subscription_overview requires SUPER_ADMIN';
              end if;

              with outstanding as (
                select academy_id,
                       count(*) filter (where status in ('OPEN','OVERDUE'))                                  as outstanding_count,
                       coalesce(sum(total_minor - amount_paid_minor) filter (where status in ('OPEN','OVERDUE')), 0) as outstanding_minor
                from academy_invoices group by academy_id
              ),
              proofs as (
                select academy_id, count(*) filter (where review_status = 'PENDING') as pending_proofs
                from academy_payment_submissions group by academy_id
              )
              select jsonb_build_object(
                'academies', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'academy_id',         a.id,
                    'academy_name',       a.name,
                    'academy_status',     a.status,
                    'plan_name',          p.name,
                    'status',             s.status,
                    'is_trial',           coalesce(s.is_trial, false),
                    'trial_end',          s.trial_end,
                    'activated_at',       s.activated_at,
                    'current_period_end', s.current_period_end,
                    'total_cost_minor',   coalesce(s.total_cost_minor, 0),
                    'currency',           coalesce(s.currency, a.default_currency),
                    'outstanding_minor',  coalesce(o.outstanding_minor, 0),
                    'outstanding_count',  coalesce(o.outstanding_count, 0),
                    'pending_proofs',     coalesce(pr.pending_proofs, 0)
                  ) order by a.name), '[]'::jsonb)
                  from academies a
                  left join academy_subscriptions s on s.academy_id = a.id and s.status <> 'ENDED'
                  left join plans p on p.id = a.plan_id
                  left join outstanding o on o.academy_id = a.id
                  left join proofs pr on pr.academy_id = a.id
                ),
                'pending_proofs', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'submission_id',    sub.id,
                    'academy_id',       sub.academy_id,
                    'academy_name',     a.name,
                    'bill_id',          sub.academy_invoice_id,
                    'method',           sub.method,
                    'amount_minor',     sub.amount_minor,
                    'note',             sub.note,
                    'created_at',       sub.created_at,
                    'bill_total_minor', ai.total_minor,
                    'currency',         ai.currency,
                    'period_start',     ai.period_start,
                    'period_end',       ai.period_end
                  ) order by sub.created_at desc), '[]'::jsonb)
                  from academy_payment_submissions sub
                  join academies a on a.id = sub.academy_id
                  join academy_invoices ai on ai.id = sub.academy_invoice_id
                  where sub.review_status = 'PENDING'
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared('drop function if exists app.admin_automation_overview();');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_automation_overview()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_automation_overview requires SUPER_ADMIN';
              end if;

              with sendcounts as (
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
                    'sent_count',              coalesce(sc.sent_count, 0),
                    'failed_count',            coalesce(sc.failed_count, 0),
                    'skipped_count',           coalesce(sc.skipped_count, 0)
                  ) order by a.name), '[]'::jsonb)
                  from academies a
                  left join academy_automation_settings s on s.academy_id = a.id
                  left join sendcounts sc on sc.academy_id = a.id
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        foreach (['app.admin_subscription_overview()', 'app.admin_automation_overview()'] as $fn) {
            DB::unprepared("alter function {$fn} owner to {$bypass};");
            DB::unprepared("revoke all on function {$fn} from public;");
            DB::unprepared("grant execute on function {$fn} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_subscription_overview();');
        DB::unprepared('drop function if exists app.admin_automation_overview();');
    }
};
