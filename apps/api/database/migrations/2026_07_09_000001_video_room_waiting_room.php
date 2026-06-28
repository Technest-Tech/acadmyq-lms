<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Waiting room, S4 (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §13). When a room has
 * `config.waiting_room = true`, a guest does not get a token at /join — instead a knock is recorded
 * and the guest short-polls until a host admits or denies. This migration adds:
 *
 *   - room_knocks      : a tenant-scoped (FORCE-RLS) queue of pending entry requests, each carrying a
 *                        high-entropy knock_token the (context-free) guest polls with, plus the
 *                        pre-allocated identity used when the guest is finally minted a token.
 *   - app.video_knock_status(text)  : the SECURITY DEFINER reader the public poll route uses (no
 *                        tenant context). A PENDING knock older than the 15-min TTL reads as 'EXPIRED'.
 *   - app.video_room_by_access_token(text) is widened to also return `host_token` — the waiting-room
 *                        "manage credential" (§13.5), so an authenticated host who opened a *guest*
 *                        link still receives a manageToken. Read server-side only; the controller
 *                        decides what to expose (never returned raw to a client).
 *
 * The bypass-owned readers are SECURITY DEFINER so they can read across tenants for the context-free
 * routes (V-TEN-1). The existing access-token reader is owned by the bypass role, so we `set role` to
 * replace it in place (the migration runner is a member); the brand-new knock reader is created by the
 * runner and then handed to the bypass role (mirrors the S2 link migration).
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

        // --- room_knocks table + RLS (standard tenant table conventions) ----------
        DB::unprepared(<<<'SQL'
            create type video_knock_status as enum ('PENDING','ADMITTED','DENIED');

            create table room_knocks (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              room_id       uuid not null references video_rooms(id) on delete cascade,
              knock_token   text not null unique,                  -- guest's bearer secret to poll status
              identity      text not null,                         -- pre-allocated identity, used at admit-mint
              display_name  text not null,                         -- shown to the host in the queue
              status        video_knock_status not null default 'PENDING',
              decided_by    uuid references users(id),             -- manager who decided (null for host-link)
              created_at    timestamptz not null default now(),
              decided_at    timestamptz,
              updated_at    timestamptz not null default now()
            );
            create index room_knocks_academy_idx on room_knocks (academy_id);
            create index room_knocks_room_idx on room_knocks (academy_id, room_id, status, created_at);
            create trigger trg_set_updated_at before update on room_knocks
              for each row execute function set_updated_at();

            alter table room_knocks enable row level security;
            alter table room_knocks force row level security;
            create policy tenant_isolation on room_knocks
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // The context-free guest poll reader (SECURITY DEFINER, bypass-owned) reads room_knocks, so
        // the bypass role needs table-level SELECT on it (BYPASSRLS skips row policies, not GRANTs —
        // mirrors the W1 `grant select on video_rooms` / S2 `grant select on academies`).
        DB::unprepared("grant select on room_knocks to {$bypass};");

        // --- widen the EXISTING access-token reader (owned by bypass → set role to replace in place) -
        DB::unprepared("set role {$bypass};");
        DB::unprepared(<<<'SQL'
            create or replace function app.video_room_by_access_token(p_token text)
            returns json
            language plpgsql
            stable
            security definer
            set search_path = public, app, pg_catalog
            as $$
            declare
                v_room record;
            begin
                select r.id, r.academy_id, r.livekit_name, r.name, r.status, r.config, r.host_token,
                       case
                           when r.host_token    = p_token then 'host'
                           when r.monitor_token = p_token then 'monitor'
                           else 'guest'
                       end as link_role
                  into v_room
                  from video_rooms r
                 where (r.join_token = p_token or r.host_token = p_token or r.monitor_token = p_token)
                   and r.status = 'ACTIVE'
                   and r.deleted_at is null
                 limit 1;

                if not found then
                    return null;
                end if;

                return json_build_object(
                    'room_id',      v_room.id,
                    'academy_id',   v_room.academy_id,
                    'livekit_name', v_room.livekit_name,
                    'name',         v_room.name,
                    'status',       v_room.status,
                    'config',       v_room.config,
                    'host_token',   v_room.host_token,
                    'link_role',    v_room.link_role
                );
            end;
            $$;
        SQL);
        DB::unprepared('revoke all on function app.video_room_by_access_token(text) from public;');
        DB::unprepared("grant execute on function app.video_room_by_access_token(text) to {$app};");
        DB::unprepared('reset role;');

        // --- NEW knock-status reader (create as runner, then hand ownership to bypass — S2 pattern) -
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
        DB::unprepared("alter function app.video_knock_status(text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.video_knock_status(text) from public;');
        DB::unprepared("grant execute on function app.video_knock_status(text) to {$app};");
    }

    public function down(): void
    {
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // Restore the access-token reader to its S2 shape (without host_token).
        DB::unprepared("set role {$bypass};");
        DB::unprepared(<<<'SQL'
            create or replace function app.video_room_by_access_token(p_token text)
            returns json
            language plpgsql
            stable
            security definer
            set search_path = public, app, pg_catalog
            as $$
            declare
                v_room record;
            begin
                select r.id, r.academy_id, r.livekit_name, r.name, r.status, r.config,
                       case
                           when r.host_token    = p_token then 'host'
                           when r.monitor_token = p_token then 'monitor'
                           else 'guest'
                       end as link_role
                  into v_room
                  from video_rooms r
                 where (r.join_token = p_token or r.host_token = p_token or r.monitor_token = p_token)
                   and r.status = 'ACTIVE'
                   and r.deleted_at is null
                 limit 1;

                if not found then
                    return null;
                end if;

                return json_build_object(
                    'room_id',      v_room.id,
                    'academy_id',   v_room.academy_id,
                    'livekit_name', v_room.livekit_name,
                    'name',         v_room.name,
                    'status',       v_room.status,
                    'config',       v_room.config,
                    'link_role',    v_room.link_role
                );
            end;
            $$;
        SQL);
        DB::unprepared('revoke all on function app.video_room_by_access_token(text) from public;');
        DB::unprepared("grant execute on function app.video_room_by_access_token(text) to {$app};");
        DB::unprepared('reset role;');

        DB::unprepared('drop function if exists app.video_knock_status(text);');
        DB::unprepared(<<<'SQL'
            drop table if exists room_knocks;
            drop type if exists video_knock_status;
        SQL);
    }
};
