<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-academy video governance — Tier 2 (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING; the
 * Super Admin "add academy to video / activate-deactivate / trial / tier" controls).
 *
 * Three nullable columns on `academies` (no backfill → no FORCE-RLS dance needed):
 *   - video_access        — per-academy override the entitlement layer always respects:
 *                           'ENABLED' (force on), 'DISABLED' (force off), NULL (follow the plan/add-on).
 *   - video_trial_ends_at — when video_access='ENABLED' and this is set, video auto-expires here
 *                           (App\Support\Entitlement turns video.conferencing OFF once it passes).
 *   - video_plan_id       — the per-academy video TIER whose `features.limits` drive the video limit
 *                           keys (maxRooms, recording, monitor, …); every non-video limit still comes
 *                           from the academy's own plan.
 *
 * Plus three audited cross-tenant SECURITY DEFINER readers for the oversight page (same contract as
 * app.admin_video_stats from the prior migration): admin_video_stats is REPLACED to list ALL
 * video-associated academies with their effective status; admin_video_academy(uuid) is the per-academy
 * detail (status + subscription + effective limits + rooms); admin_video_room_logs(uuid) is the
 * cross-tenant per-room access log.
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

        // --- columns (all nullable; FK validates trivially against all-NULL) ----------
        DB::unprepared(<<<'SQL'
            alter table academies add column video_access        text,
                                  add column video_trial_ends_at timestamptz,
                                  add column video_plan_id        uuid references plans(id);
            alter table academies add constraint academies_video_access_chk
              check (video_access is null or video_access in ('ENABLED','DISABLED'));
        SQL);

        // The detail/list readers join these (bypass already has academies/plans/video_rooms/
        // room_recordings/room_participants/audit_log/users from earlier migrations).
        DB::unprepared("grant select on academy_subscriptions to {$bypass};");
        DB::unprepared("grant select on academy_addons to {$bypass};");
        DB::unprepared("grant select on add_ons to {$bypass};");

        // --- admin_video_stats: REPLACED to list every video-associated academy + status ----
        DB::unprepared('drop function if exists app.admin_video_stats();');
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
              base as (
                select
                  a.id as academy_id, a.name as academy_name, a.default_currency as currency,
                  p.name as plan_name, p.code as plan_code,
                  vp.name as video_plan_name,
                  a.video_access, a.video_trial_ends_at, a.video_plan_id,
                  (coalesce(p.features->'capabilities','[]'::jsonb) @> '"video.conferencing"'::jsonb
                   or exists (select 1 from academy_addons aa join add_ons ao on ao.id = aa.add_on_id
                              where aa.academy_id = a.id and aa.is_active and ao.feature_key = 'video.conferencing')
                  ) as base_entitled,
                  nullif(coalesce(vp.features->'limits'->>'maxRooms', p.features->'limits'->>'maxRooms'), '')::int as max_rooms
                from academies a
                left join plans p  on p.id  = a.plan_id
                left join plans vp on vp.id = a.video_plan_id
              ),
              status as (
                select b.*,
                  case
                    when b.video_access = 'DISABLED' then 'DISABLED'
                    when b.video_access = 'ENABLED' and b.video_trial_ends_at is null then 'ENABLED'
                    when b.video_access = 'ENABLED' and b.video_trial_ends_at > now() then 'TRIAL'
                    when b.video_access = 'ENABLED' then 'EXPIRED'
                    when b.base_entitled then 'PLAN'
                    else 'NONE'
                  end as video_status
                from base b
              ),
              per_academy as (
                select s.academy_id, s.academy_name, s.currency, s.plan_name, s.plan_code,
                  s.video_plan_name, s.video_access, s.video_trial_ends_at, s.video_status, s.max_rooms,
                  (s.video_status in ('ENABLED','TRIAL','PLAN')) as video_enabled,
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

        // --- admin_video_academy(uuid): per-academy detail ----------------------------
        DB::unprepared('drop function if exists app.admin_video_academy(uuid);');
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
                    'created_at', a.created_at,
                    'plan_id', a.plan_id, 'plan_name', p.name, 'plan_code', p.code,
                    'video_plan_id', a.video_plan_id, 'video_plan_name', vp.name,
                    'video_access', a.video_access, 'video_trial_ends_at', a.video_trial_ends_at,
                    'base_entitled', (coalesce(p.features->'capabilities','[]'::jsonb) @> '"video.conferencing"'::jsonb
                       or exists (select 1 from academy_addons aa join add_ons ao on ao.id = aa.add_on_id
                                  where aa.academy_id = a.id and aa.is_active and ao.feature_key = 'video.conferencing')),
                    'video_status', case
                       when a.video_access = 'DISABLED' then 'DISABLED'
                       when a.video_access = 'ENABLED' and a.video_trial_ends_at is null then 'ENABLED'
                       when a.video_access = 'ENABLED' and a.video_trial_ends_at > now() then 'TRIAL'
                       when a.video_access = 'ENABLED' then 'EXPIRED'
                       when (coalesce(p.features->'capabilities','[]'::jsonb) @> '"video.conferencing"'::jsonb
                             or exists (select 1 from academy_addons aa join add_ons ao on ao.id = aa.add_on_id
                                        where aa.academy_id = a.id and aa.is_active and ao.feature_key = 'video.conferencing')) then 'PLAN'
                       else 'NONE' end,
                    -- effective video limits: the video tier wins per key, else the academy's plan.
                    'video_limits', jsonb_strip_nulls(jsonb_build_object(
                      'maxRooms',               coalesce(vp.features->'limits'->'maxRooms',               p.features->'limits'->'maxRooms'),
                      'maxRoomParticipants',    coalesce(vp.features->'limits'->'maxRoomParticipants',    p.features->'limits'->'maxRoomParticipants'),
                      'recordingRetentionDays', coalesce(vp.features->'limits'->'recordingRetentionDays', p.features->'limits'->'recordingRetentionDays'),
                      'recordingAllowed',       coalesce(vp.features->'limits'->'recordingAllowed',       p.features->'limits'->'recordingAllowed'),
                      'monitorAllowed',         coalesce(vp.features->'limits'->'monitorAllowed',         p.features->'limits'->'monitorAllowed')
                    ))
                  )
                  from academies a
                  left join plans p  on p.id  = a.plan_id
                  left join plans vp on vp.id = a.video_plan_id
                  where a.id = p_academy
                ),
                'subscription', (
                  select jsonb_build_object(
                    'status', s.status, 'is_trial', s.is_trial,
                    'trial_start', s.trial_start, 'trial_end', s.trial_end,
                    'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
                    'currency', s.currency, 'plan_name', sp.name
                  )
                  from academy_subscriptions s
                  left join plans sp on sp.id = s.plan_id
                  where s.academy_id = p_academy and s.status <> 'ENDED'
                  order by s.id desc limit 1
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

        // --- admin_video_room_logs(uuid): cross-tenant per-room access log -------------
        DB::unprepared('drop function if exists app.admin_video_room_logs(uuid);');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_video_room_logs(p_room uuid)
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare result jsonb; v_cap int := 500;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_video_room_logs requires SUPER_ADMIN';
              end if;

              select jsonb_build_object(
                'room', (
                  select jsonb_build_object('id', r.id, 'academy_id', r.academy_id, 'name', r.name,
                    'status', r.status, 'created_at', r.created_at)
                  from video_rooms r where r.id = p_room
                ),
                'sessions', coalesce((
                  select jsonb_agg(j order by joined_at desc) from (
                    select jsonb_build_object(
                      'id', rp.id, 'identity', rp.identity, 'display_name', rp.display_name,
                      'user_id', rp.user_id, 'user_name', u.full_name, 'role', rp.role,
                      'joined_at', rp.joined_at, 'left_at', rp.left_at,
                      'duration_s', case when rp.left_at is not null
                        then greatest(0, extract(epoch from (rp.left_at - rp.joined_at))::int) else null end,
                      'ongoing', (rp.left_at is null)
                    ) as j, rp.joined_at as joined_at
                    from room_participants rp
                    left join users u on u.id = rp.user_id
                    where rp.room_id = p_room
                    order by rp.joined_at desc limit v_cap
                  ) s
                ), '[]'::jsonb),
                'events', coalesce((
                  select jsonb_agg(j order by created_at desc) from (
                    select jsonb_build_object(
                      'id', al.id, 'action', al.action, 'actor_user_id', al.actor_user_id,
                      'actor_name', u.full_name, 'actor_role', al.actor_role,
                      'after', al.after, 'created_at', al.created_at
                    ) as j, al.created_at as created_at
                    from audit_log al
                    left join users u on u.id = al.actor_user_id
                    where al.entity_type = 'video_room' and al.entity_id = p_room
                    order by al.created_at desc limit v_cap
                  ) e
                ), '[]'::jsonb)
              ) into result;

              if result->'room' is null or jsonb_typeof(result->'room') = 'null' then
                return null;
              end if;

              return result;
            end;
            $$;
        SQL);

        foreach (['admin_video_stats()', 'admin_video_academy(uuid)', 'admin_video_room_logs(uuid)'] as $sig) {
            DB::unprepared("alter function app.{$sig} owner to {$bypass};");
            DB::unprepared("revoke all on function app.{$sig} from public;");
            DB::unprepared("grant execute on function app.{$sig} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_video_academy(uuid);');
        DB::unprepared('drop function if exists app.admin_video_room_logs(uuid);');
        // Restore the prior (usage-only) admin_video_stats from migration 2026_07_11_000001.
        DB::unprepared('drop function if exists app.admin_video_stats();');
        DB::unprepared(<<<'SQL'
            alter table academies drop constraint if exists academies_video_access_chk;
            alter table academies drop column if exists video_access,
                                  drop column if exists video_trial_ends_at,
                                  drop column if exists video_plan_id;
        SQL);
    }
};
