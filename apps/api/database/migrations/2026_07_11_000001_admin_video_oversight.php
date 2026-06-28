<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Super Admin video oversight — Tier 1 (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING).
 *
 * Two audited cross-tenant escape hatches, following the `app.admin_dashboard_stats()` /
 * `app.admin_audit()` contract exactly: SECURITY DEFINER (so they bypass RLS), owned by the
 * bypass role, guarded by a SUPER_ADMIN check in the body, EXECUTE-locked to the app role, and
 * returning a curated aggregate projection — never a raw cross-tenant row dump.
 *
 *   - app.admin_video_stats()        — per-academy usage: active rooms (vs the plan's maxRooms
 *                                       limit), completed-recording count + storage bytes +
 *                                       recording-seconds, in-flight (concurrent) recordings, and
 *                                       attendance sessions; plus platform-wide totals (the
 *                                       concurrent-recording total feeds the capacity hint).
 *   - app.admin_video_audit(uuid,int,int) — the platform-wide monitor & recording COMPLIANCE feed:
 *                                       the sensitive video.* / video_room.* / video_recording.*
 *                                       audit actions, by academy/actor/time, paginated.
 *
 * The bypass role already holds SELECT on video_rooms (the join_token reader migration), academies
 * + audit_log (the dashboard/audit migrations) and plans (the academy-type migration). It still
 * needs SELECT on room_recordings + room_participants — granted here.
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

        // The definer bypasses RLS but still needs table-level SELECT. video_rooms/academies/plans/
        // audit_log are already granted by earlier migrations; the two recording/attendance tables
        // are not — grant them (idempotent).
        DB::unprepared("grant select on room_recordings to {$bypass};");
        DB::unprepared("grant select on room_participants to {$bypass};");

        // ── Usage stats ──────────────────────────────────────────────────────────
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
                from video_rooms
                group by academy_id
              ),
              rec_agg as (
                select academy_id,
                  count(*) filter (where status = 'COMPLETED')                              as recordings_count,
                  coalesce(sum(bytes)      filter (where status = 'COMPLETED'), 0)::bigint   as storage_bytes,
                  coalesce(sum(duration_s) filter (where status = 'COMPLETED'), 0)::bigint   as recording_seconds,
                  count(*) filter (where status in ('STARTING','RECORDING'))                 as active_recordings
                from room_recordings
                group by academy_id
              ),
              part_agg as (
                select academy_id, count(*) as participant_sessions
                from room_participants
                group by academy_id
              ),
              ids as (
                select academy_id from room_agg
                union
                select academy_id from rec_agg
              ),
              per_academy as (
                select
                  a.id                                            as academy_id,
                  a.name                                          as academy_name,
                  p.name                                          as plan_name,
                  coalesce(ra.active_rooms, 0)                    as active_rooms,
                  coalesce(ra.live_rooms, 0)                      as live_rooms,
                  nullif(p.features->'limits'->>'maxRooms', '')::int as max_rooms,
                  coalesce(rc.recordings_count, 0)                as recordings_count,
                  coalesce(rc.storage_bytes, 0)                   as storage_bytes,
                  coalesce(rc.recording_seconds, 0)               as recording_seconds,
                  coalesce(rc.active_recordings, 0)               as active_recordings,
                  coalesce(pa.participant_sessions, 0)            as participant_sessions
                from ids
                join academies a on a.id = ids.academy_id
                left join plans p   on p.id = a.plan_id
                left join room_agg ra on ra.academy_id = ids.academy_id
                left join rec_agg rc  on rc.academy_id = ids.academy_id
                left join part_agg pa on pa.academy_id = ids.academy_id
              )
              select jsonb_build_object(
                'academies', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'academy_id',           academy_id,
                    'academy_name',         academy_name,
                    'plan_name',            plan_name,
                    'active_rooms',         active_rooms,
                    'live_rooms',           live_rooms,
                    'max_rooms',            max_rooms,
                    'recordings_count',     recordings_count,
                    'storage_bytes',        storage_bytes,
                    'recording_seconds',    recording_seconds,
                    'active_recordings',    active_recordings,
                    'participant_sessions', participant_sessions
                  ) order by active_rooms desc, storage_bytes desc, academy_name)
                  from per_academy
                ), '[]'::jsonb),
                'totals', (
                  select jsonb_build_object(
                    'academies',         count(*),
                    'active_rooms',      coalesce(sum(active_rooms), 0),
                    'recordings_count',  coalesce(sum(recordings_count), 0),
                    'storage_bytes',     coalesce(sum(storage_bytes), 0),
                    'recording_seconds', coalesce(sum(recording_seconds), 0),
                    'active_recordings', coalesce(sum(active_recordings), 0)
                  )
                  from per_academy
                )
              )
              into result;

              return result;
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_video_stats() owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_video_stats() from public;');
        DB::unprepared("grant execute on function app.admin_video_stats() to {$app};");

        // ── Compliance / activity audit feed ─────────────────────────────────────
        DB::unprepared('drop function if exists app.admin_video_audit(uuid, int, int);');
        DB::unprepared(<<<'SQL'
            create or replace function app.admin_video_audit(
              p_academy uuid,
              p_limit   int,
              p_offset  int
            )
            returns jsonb
            language plpgsql stable security definer
            set search_path = public, app
            as $$
            declare total bigint; rows jsonb;
            begin
              if app.current_role() is distinct from 'SUPER_ADMIN' then
                raise exception 'forbidden: app.admin_video_audit requires SUPER_ADMIN';
              end if;

              select count(*) into total
              from audit_log al
              where (al.action like 'video.%' or al.action like 'video_room.%' or al.action like 'video_recording.%')
                and (p_academy is null or al.academy_id = p_academy);

              select coalesce(jsonb_agg(sub.j order by sub.created_at desc), '[]'::jsonb)
              into rows
              from (
                select jsonb_build_object(
                  'id',            al.id,
                  'academy_id',    al.academy_id,
                  'academy_name',  a.name,
                  'actor_user_id', al.actor_user_id,
                  'actor_name',    u.full_name,
                  'actor_role',    al.actor_role,
                  'action',        al.action,
                  'entity_type',   al.entity_type,
                  'entity_id',     al.entity_id,
                  'after',         al.after,
                  'created_at',    al.created_at
                ) as j,
                al.created_at as created_at
                from audit_log al
                left join academies a on a.id = al.academy_id
                left join users u on u.id = al.actor_user_id
                where (al.action like 'video.%' or al.action like 'video_room.%' or al.action like 'video_recording.%')
                  and (p_academy is null or al.academy_id = p_academy)
                order by al.created_at desc
                limit greatest(p_limit, 0) offset greatest(p_offset, 0)
              ) sub;

              return jsonb_build_object('rows', rows, 'total', total);
            end;
            $$;
        SQL);

        DB::unprepared("alter function app.admin_video_audit(uuid, int, int) owner to {$bypass};");
        DB::unprepared('revoke all on function app.admin_video_audit(uuid, int, int) from public;');
        DB::unprepared("grant execute on function app.admin_video_audit(uuid, int, int) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.admin_video_stats();');
        DB::unprepared('drop function if exists app.admin_video_audit(uuid, int, int);');
    }
};
