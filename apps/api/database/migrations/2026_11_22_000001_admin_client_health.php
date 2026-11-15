<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Super Admin → System health → "needs attention" (2026-11-15). Until now a client's operational
 * trouble reached the platform owner as a complaint: the WhatsApp number dropped, reminders stopped
 * going out, lessons piled up unmarked, the timetable stopped producing lessons. Each of those is
 * already a fact in the database; this reader hands them over for every client in one read.
 *
 * It returns FACTS only — counts, timestamps, the stored connection state. What counts as a
 * problem (and how bad) is decided in PHP (App\Support\ClientAttention), where it can be tested and
 * retuned without a migration.
 *
 * Function body + idempotent grants only — no table DDL, nothing a re-run can poison (M-PROC-2).
 * Same shape as every cross-tenant read (§3.4): SECURITY DEFINER, owned by the bypass role,
 * SUPER_ADMIN re-asserted inside.
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

        DB::unprepared(
            'grant select on academies, students, sessions, schedules, audit_log, module_subscriptions, '
            ."academy_automation_settings, automation_send_log to {$bypass};"
        );

        DB::unprepared(<<<'SQL'
            create or replace function app.admin_client_health(overdue_grace_hours integer default 4)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_client_health requires SUPER_ADMIN';
              end if;

              select coalesce(jsonb_agg(jsonb_build_object(
                'id',                    a.id,
                'name',                  a.name,
                'client_type',           a.client_type,
                'status',                a.status,
                'created_at',            a.created_at,
                'modules',               coalesce(ms.modules, '[]'::jsonb),
                'trial_end',             ms.trial_end,
                'last_login_at',         li.at,
                -- Lessons that ended more than the grace ago and nobody marked (الحصص المعلقة):
                -- the same predicate as GET /api/sessions/overdue.
                'overdue_lessons',       coalesce(ov.n, 0),
                'oldest_overdue_end',    ov.oldest_end,
                -- The timetable: live weekly timetables, lessons in the last 14 days, lessons ahead.
                'active_schedules',      coalesce(sc.n, 0),
                'lessons_last_14d',      coalesce(lr.n, 0),
                'lessons_next_7d',       coalesce(lu.n, 0),
                -- WhatsApp: the number's last reported state, whether reminders were launched,
                -- and what the last day's sends did. The send log holds EVERY message the platform
                -- sends (group alerts included), one row per attempt.
                'wa_status',             s.wasender_session_status,
                'wa_linked',             (s.wa_session_id is not null),
                'reminders_live',        coalesce(s.lesson_reminders_live, false),
                'wa_sent_24h',           coalesce(sl.sent, 0),
                'wa_failed_24h',         coalesce(sl.failed, 0)
              ) order by a.name), '[]'::jsonb)
              into result
              from academies a
              left join academy_automation_settings s on s.academy_id = a.id
              left join lateral (
                select jsonb_agg(m.module order by m.module) as modules,
                       min(m.trial_end) filter (where m.is_trial) as trial_end
                from module_subscriptions m
                where m.academy_id = a.id and m.status = 'ACTIVE'
              ) ms on true
              left join lateral (
                select max(al.created_at) as at from audit_log al
                where al.academy_id = a.id and al.action = 'auth.login'
              ) li on true
              left join lateral (
                select count(*) as n,
                       min(se.scheduled_at_utc + make_interval(mins => se.duration_minutes)) as oldest_end
                from sessions se
                where se.academy_id = a.id
                  and se.status = 'SCHEDULED'
                  and se.hidden_at is null
                  and not exists (select 1 from students rm where rm.id = se.student_id and rm.deleted_at is not null)
                  and se.scheduled_at_utc + make_interval(mins => se.duration_minutes)
                      <= now() - make_interval(hours => overdue_grace_hours)
              ) ov on true
              left join lateral (
                select count(*) as n from schedules sh
                join students st on st.id = sh.student_id and st.deleted_at is null
                where sh.academy_id = a.id and sh.is_active and sh.deleted_at is null
              ) sc on true
              left join lateral (
                select count(*) as n from sessions se
                where se.academy_id = a.id and se.hidden_at is null
                  and se.scheduled_at_utc >= now() - interval '14 days' and se.scheduled_at_utc < now()
              ) lr on true
              left join lateral (
                select count(*) as n from sessions se
                where se.academy_id = a.id and se.hidden_at is null
                  and se.scheduled_at_utc >= now() and se.scheduled_at_utc < now() + interval '7 days'
              ) lu on true
              left join lateral (
                select count(*) filter (where l.status = 'SENT')   as sent,
                       count(*) filter (where l.status = 'FAILED') as failed
                from automation_send_log l
                where l.academy_id = a.id and l.created_at > now() - interval '24 hours'
              ) sl on true;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_client_health(integer) owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_client_health(integer) from public;');
        DB::unprepared("grant execute on function app.admin_client_health(integer) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_client_health(integer);');
    }
};
