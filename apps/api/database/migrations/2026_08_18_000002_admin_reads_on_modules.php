<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * docs/superadmin-modules/05-MODULES-NOT-PACKAGES — re-point the Super Admin's cross-tenant reads at
 * the module subscriptions now that packages no longer decide anything.
 *
 *  - `app.admin_client_directory()` gains the client's TYPE and each module's own price + overrides,
 *    so the clients hub can show what a client is, what it pays and how many features we switched off.
 *  - `app.admin_video_stats()` / `app.admin_video_academy()` derive video state from the VIDEO module
 *    row instead of `academies.video_access` + the plan's capabilities. A client who was sold the
 *    module is ENABLED/TRIAL; a paused module reads PAUSED (a new status); the legacy force-off
 *    override still reads DISABLED. Their caps come from the client's own per-module overrides.
 *
 * Function bodies only — no table DDL, so nothing here can poison a re-run (M-PROC-2).
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

        // ── The clients hub read ────────────────────────────────────────────────
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
                    'client_type',      a.client_type,
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

        // ── Video oversight: the VIDEO module row is the truth ───────────────────
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_video_stats()
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_video_stats requires SUPER_ADMIN';
              end if;

              with room_agg as (
                select academy_id,
                  count(*) filter (where deleted_at is null and status = 'ACTIVE') as active_rooms,
                  count(*) filter (where deleted_at is null)                        as live_rooms,
                  count(*)                                                          as total_rooms
                from video_rooms group by academy_id
              ),
              rec_agg as (
                select academy_id,
                  count(*) filter (where status = 'COMPLETED')                            as recordings_count,
                  coalesce(sum(bytes)      filter (where status = 'COMPLETED'), 0)::bigint as storage_bytes,
                  coalesce(sum(duration_s) filter (where status = 'COMPLETED'), 0)::bigint as recording_seconds,
                  count(*) filter (where status in ('STARTING','RECORDING'))               as active_recordings
                from room_recordings group by academy_id
              ),
              part_agg as (
                select academy_id, count(*) as participant_sessions from room_participants group by academy_id
              ),
              vsub as (
                select distinct on (ms.academy_id)
                  ms.academy_id, ms.status, ms.is_trial, ms.trial_end, ms.overrides,
                  ms.total_cost_minor, ms.currency
                from module_subscriptions ms
                where ms.module = 'VIDEO' and ms.status <> 'ENDED'
                order by ms.academy_id, ms.created_at desc
              ),
              base as (
                select
                  a.id as academy_id, a.name as academy_name, a.default_currency as currency,
                  a.client_type,
                  p.name as plan_name, p.code as plan_code,
                  null::text as video_plan_name,
                  case when v.academy_id is null then null
                       when coalesce(v.overrides->>'access','') = 'DISABLED' then 'DISABLED'
                       else 'ENABLED' end as video_access,
                  case when v.is_trial then v.trial_end else null end as video_trial_ends_at,
                  nullif(v.overrides->'limits'->>'maxRooms','')::int as max_rooms,
                  v.academy_id as has_module, v.status as module_status, v.is_trial, v.trial_end,
                  coalesce(v.overrides->>'access','') as access_override
                from academies a
                left join plans p on p.id = a.plan_id
                left join vsub v on v.academy_id = a.id
              ),
              status as (
                select b.*,
                  case
                    when b.has_module is null                                    then 'NONE'
                    when b.access_override = 'DISABLED'                          then 'DISABLED'
                    when b.module_status <> 'ACTIVE'                             then 'PAUSED'
                    when b.is_trial and b.trial_end is not null
                         and b.trial_end <= now()                                then 'EXPIRED'
                    when b.is_trial                                              then 'TRIAL'
                    else 'ENABLED'
                  end as video_status
                from base b
              ),
              per_academy as (
                select s.academy_id, s.academy_name, s.currency, s.client_type, s.plan_name, s.plan_code,
                  s.video_plan_name, s.video_access, s.video_trial_ends_at, s.video_status, s.max_rooms,
                  (s.video_status in ('ENABLED','TRIAL')) as video_enabled,
                  coalesce(ra.active_rooms, 0)          as active_rooms,
                  coalesce(ra.live_rooms, 0)            as live_rooms,
                  coalesce(rc.recordings_count, 0)      as recordings_count,
                  coalesce(rc.storage_bytes, 0)         as storage_bytes,
                  coalesce(rc.recording_seconds, 0)     as recording_seconds,
                  coalesce(rc.active_recordings, 0)     as active_recordings,
                  coalesce(pa.participant_sessions, 0)  as participant_sessions
                from status s
                left join room_agg ra on ra.academy_id = s.academy_id
                left join rec_agg  rc on rc.academy_id = s.academy_id
                left join part_agg pa on pa.academy_id = s.academy_id
                where s.video_status <> 'NONE' or ra.academy_id is not null or rc.academy_id is not null
              )
              select jsonb_build_object(
                'academies', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'academy_id', academy_id, 'academy_name', academy_name, 'currency', currency,
                    'client_type', client_type,
                    'plan_name', plan_name, 'plan_code', plan_code, 'video_plan_name', video_plan_name,
                    'video_access', video_access, 'video_trial_ends_at', video_trial_ends_at,
                    'video_status', video_status, 'video_enabled', video_enabled,
                    'active_rooms', active_rooms, 'live_rooms', live_rooms, 'max_rooms', max_rooms,
                    'recordings_count', recordings_count, 'storage_bytes', storage_bytes,
                    'recording_seconds', recording_seconds, 'active_recordings', active_recordings,
                    'participant_sessions', participant_sessions
                  ) order by video_enabled desc, active_rooms desc, academy_name)
                  from per_academy
                ), '[]'::jsonb),
                'totals', (
                  select jsonb_build_object(
                    'academies', count(*),
                    'enabled', count(*) filter (where video_enabled),
                    'trial', count(*) filter (where video_status = 'TRIAL'),
                    'active_rooms', coalesce(sum(active_rooms), 0),
                    'recordings_count', coalesce(sum(recordings_count), 0),
                    'storage_bytes', coalesce(sum(storage_bytes), 0),
                    'recording_seconds', coalesce(sum(recording_seconds), 0),
                    'active_recordings', coalesce(sum(active_recordings), 0)
                  ) from per_academy
                )
              ) into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared(<<<'SQL'
            create or replace function app.admin_video_academy(p_academy uuid)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_video_academy requires SUPER_ADMIN';
              end if;

              select jsonb_build_object(
                'academy', (
                  select jsonb_build_object(
                    'id', a.id, 'name', a.name, 'currency', a.default_currency, 'subdomain', a.subdomain,
                    'created_at', a.created_at, 'client_type', a.client_type,
                    'plan_id', a.plan_id, 'plan_name', p.name, 'plan_code', p.code,
                    'video_plan_id', null, 'video_plan_name', null,
                    'video_access', case when v.academy_id is null then null
                                         when coalesce(v.overrides->>'access','') = 'DISABLED' then 'DISABLED'
                                         else 'ENABLED' end,
                    'video_trial_ends_at', case when v.is_trial then v.trial_end else null end,
                    'base_entitled', (v.academy_id is not null),
                    'video_status', case
                       when v.academy_id is null                            then 'NONE'
                       when coalesce(v.overrides->>'access','') = 'DISABLED' then 'DISABLED'
                       when v.status <> 'ACTIVE'                            then 'PAUSED'
                       when v.is_trial and v.trial_end is not null and v.trial_end <= now() then 'EXPIRED'
                       when v.is_trial                                      then 'TRIAL'
                       else 'ENABLED' end,
                    -- The client's own caps (absent ⇒ unlimited, the platform default applies).
                    'video_limits', coalesce(v.overrides->'limits', '{}'::jsonb)
                  )
                  from academies a
                  left join plans p on p.id = a.plan_id
                  left join lateral (
                    select ms.academy_id, ms.status, ms.is_trial, ms.trial_end, ms.overrides
                    from module_subscriptions ms
                    where ms.academy_id = a.id and ms.module = 'VIDEO' and ms.status <> 'ENDED'
                    order by ms.created_at desc limit 1
                  ) v on true
                  where a.id = p_academy
                ),
                'subscription', (
                  select jsonb_build_object(
                    'status', ms.status, 'is_trial', ms.is_trial,
                    'trial_start', ms.trial_start, 'trial_end', ms.trial_end,
                    'current_period_start', ms.current_period_start, 'current_period_end', ms.current_period_end,
                    'currency', ms.currency, 'plan_name', null
                  )
                  from module_subscriptions ms
                  where ms.academy_id = p_academy and ms.module = 'VIDEO' and ms.status <> 'ENDED'
                  order by ms.created_at desc limit 1
                ),
                'stats', (
                  select jsonb_build_object(
                    'active_rooms',     count(*) filter (where r.deleted_at is null and r.status = 'ACTIVE'),
                    'total_rooms',      count(*),
                    'recordings_count', (select count(*) from room_recordings rr where rr.academy_id = p_academy and rr.status = 'COMPLETED'),
                    'storage_bytes',    (select coalesce(sum(bytes),0)::bigint from room_recordings rr where rr.academy_id = p_academy and rr.status = 'COMPLETED'),
                    'recording_seconds',(select coalesce(sum(duration_s),0)::bigint from room_recordings rr where rr.academy_id = p_academy and rr.status = 'COMPLETED'),
                    'active_recordings',(select count(*) from room_recordings rr where rr.academy_id = p_academy and rr.status in ('STARTING','RECORDING')),
                    'participant_sessions', (select count(*) from room_participants rp where rp.academy_id = p_academy)
                  ) from video_rooms r where r.academy_id = p_academy
                ),
                'rooms', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', r.id, 'name', r.name, 'status', r.status,
                    'created_at', r.created_at, 'deleted_at', r.deleted_at,
                    'recordings_count', (select count(*) from room_recordings rr where rr.room_id = r.id and rr.status = 'COMPLETED'),
                    'storage_bytes',    (select coalesce(sum(bytes),0)::bigint from room_recordings rr where rr.room_id = r.id and rr.status = 'COMPLETED'),
                    'active_recordings',(select count(*) from room_recordings rr where rr.room_id = r.id and rr.status in ('STARTING','RECORDING')),
                    'participant_sessions', (select count(*) from room_participants rp where rp.room_id = r.id),
                    'last_activity', (select max(rp.joined_at) from room_participants rp where rp.room_id = r.id)
                  ) order by r.created_at desc)
                  from video_rooms r where r.academy_id = p_academy
                ), '[]'::jsonb)
              ) into result;

              -- A missing academy makes the scalar subquery yield JSON null (not SQL NULL).
              if result->'academy' is null or jsonb_typeof(result->'academy') = 'null' then
                return null;
              end if;

              return result;
            end;
            $$;
        SQL);

        foreach (['app.admin_client_directory()', 'app.admin_video_stats()', 'app.admin_video_academy(uuid)'] as $fn) {
            DB::unprepared("alter function {$fn} owner to {$bypass};");
            DB::unprepared("revoke all on function {$fn} from public;");
            DB::unprepared("grant execute on function {$fn} to {$app};");
        }
    }

    public function down(): void
    {
        // Intentionally empty: these are `create or replace` bodies owned by earlier migrations —
        // rolling back to their previous definition means re-running those, and dropping the
        // functions here would leave the panel blind on a partial rollback.
    }
};
