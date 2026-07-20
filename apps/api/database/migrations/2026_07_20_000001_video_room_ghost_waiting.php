<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Ghost waiting room (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §13, extends S4). When a room
 * has `config.ghost_waiting_room = true`, a MONITOR/ghost-link entrant no longer joins silently — they
 * knock exactly like a guest, and the host (e.g. a female teacher who wants to accept an observer
 * before class) admits or denies them. Requested by academies whose teachers must consent to any
 * hidden supervisor entering their room.
 *
 * The knock queue (room_knocks) is reused; this migration tags each knock with the role that will be
 * minted on admit and records the audit actor for a monitor knock, so `knockStatus` mints the correct
 * token (a hidden monitor token, never a guest token) and the `video_room.monitor_join` audit still
 * names WHO watched at the moment they actually enter:
 *
 *   - room_knocks.role           : 'guest' (default, unchanged behaviour) | 'monitor'.
 *   - room_knocks.actor_user_id  : the signed-in monitor's user id, or null for an anonymous link.
 *   - room_knocks.actor_role     : the role that granted room.monitor (audit trail), or 'MONITOR_LINK'.
 *   - app.video_knock_status(text) is widened to return `role`, `actor_user_id`, `actor_role`.
 *
 * The reader is owned by the bypass role (created that way in the S4 migration), so we `set role` to
 * replace it in place — the migration runner is a member (same discipline as S4).
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

        // --- widen room_knocks with the mint role + monitor audit actor -----------------
        DB::unprepared(<<<'SQL'
            alter table room_knocks
              add column role          text not null default 'guest'
                check (role in ('guest','monitor')),
              add column actor_user_id uuid references users(id),
              add column actor_role    text;
        SQL);

        // --- widen the knock-status reader to also return role + audit actor (bypass-owned) -
        DB::unprepared("set role {$bypass};");
        DB::unprepared(<<<'SQL'
            create or replace function app.video_knock_status(p_token text)
            returns json
            language plpgsql
            stable
            security definer
            set search_path = public, app, pg_catalog
            as $$
            declare
                v record;
            begin
                select k.id, k.identity, k.display_name, k.role, k.actor_user_id, k.actor_role,
                       case
                           when k.status = 'PENDING' and k.created_at < now() - interval '15 minutes'
                               then 'EXPIRED'
                           else k.status::text
                       end as status,
                       r.id as room_id, r.academy_id, r.livekit_name, r.name, r.config
                  into v
                  from room_knocks k
                  join video_rooms r on r.id = k.room_id
                 where k.knock_token = p_token
                   and r.status = 'ACTIVE'
                   and r.deleted_at is null
                 limit 1;

                if not found then
                    return null;
                end if;

                return json_build_object(
                    'knock_id',      v.id,
                    'status',        v.status,
                    'identity',      v.identity,
                    'display_name',  v.display_name,
                    'role',          v.role,
                    'actor_user_id', v.actor_user_id,
                    'actor_role',    v.actor_role,
                    'room_id',       v.room_id,
                    'academy_id',    v.academy_id,
                    'livekit_name',  v.livekit_name,
                    'name',          v.name,
                    'config',        v.config
                );
            end;
            $$;
        SQL);
        DB::unprepared('revoke all on function app.video_knock_status(text) from public;');
        DB::unprepared("grant execute on function app.video_knock_status(text) to {$app};");
        DB::unprepared('reset role;');
    }

    public function down(): void
    {
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // Restore the S4 reader shape (without role/actor fields).
        DB::unprepared("set role {$bypass};");
        DB::unprepared(<<<'SQL'
            create or replace function app.video_knock_status(p_token text)
            returns json
            language plpgsql
            stable
            security definer
            set search_path = public, app, pg_catalog
            as $$
            declare
                v record;
            begin
                select k.id, k.identity, k.display_name,
                       case
                           when k.status = 'PENDING' and k.created_at < now() - interval '15 minutes'
                               then 'EXPIRED'
                           else k.status::text
                       end as status,
                       r.id as room_id, r.academy_id, r.livekit_name, r.name, r.config
                  into v
                  from room_knocks k
                  join video_rooms r on r.id = k.room_id
                 where k.knock_token = p_token
                   and r.status = 'ACTIVE'
                   and r.deleted_at is null
                 limit 1;

                if not found then
                    return null;
                end if;

                return json_build_object(
                    'knock_id',     v.id,
                    'status',       v.status,
                    'identity',     v.identity,
                    'display_name', v.display_name,
                    'room_id',      v.room_id,
                    'academy_id',   v.academy_id,
                    'livekit_name', v.livekit_name,
                    'name',         v.name,
                    'config',       v.config
                );
            end;
            $$;
        SQL);
        DB::unprepared('revoke all on function app.video_knock_status(text) from public;');
        DB::unprepared("grant execute on function app.video_knock_status(text) to {$app};");
        DB::unprepared('reset role;');

        DB::unprepared(<<<'SQL'
            alter table room_knocks
              drop column if exists role,
              drop column if exists actor_user_id,
              drop column if exists actor_role;
        SQL);
    }
};
