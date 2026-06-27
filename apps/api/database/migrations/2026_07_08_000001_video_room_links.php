<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Role-separated room links + short slugs, S2 (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §2/§3).
 * Adds three columns to video_rooms:
 *   - slug          — academy-chosen short handle, UNIQUE PER ACADEMY (the readable guest link
 *                     /r/{academy}/{room}); guessable, so only allowed behind a guest password.
 *   - host_token    — high-entropy private link granting host (roomAdmin); rotatable.
 *   - monitor_token — high-entropy private link for supervisor mode (wired in S3); rotatable.
 *
 * Plus two context-free SECURITY DEFINER readers (the public join routes carry no tenant context):
 *   - app.video_room_by_access_token(text) — supersedes the join_token reader: matches join/host/
 *     monitor token and returns the resolved link_role (guest|host|monitor) + config.
 *   - app.video_room_by_slug(academy, slug) — resolves a room from its academy subdomain + slug
 *     (always a guest link).
 *
 * Backfilling host_token/monitor_token on a populated FORCE-RLS tenant table fails (the migration
 * runs as the owner with no tenant context → 0 rows), so we drop FORCE for the backfill only and
 * restore it (the W1 gotcha). New rooms get their tokens from VideoJoinToken at creation.
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

        // --- columns + backfill + constraints -------------------------------------
        DB::unprepared(<<<'SQL'
            alter table video_rooms add column slug          text;
            alter table video_rooms add column host_token    text;
            alter table video_rooms add column monitor_token text;

            alter table video_rooms no force row level security;
            update video_rooms
               set host_token    = md5(id::text || random()::text || clock_timestamp()::text)
                                    || md5(random()::text || clock_timestamp()::text),
                   monitor_token = md5(id::text || 'm' || random()::text || clock_timestamp()::text)
                                    || md5('m' || random()::text || clock_timestamp()::text)
             where host_token is null or monitor_token is null;
            alter table video_rooms force row level security;

            -- Nullable on purpose: real rooms always get tokens from VideoRoomController at creation
            -- (and existing rows are backfilled above), but a room may legitimately have none until a
            -- link is generated. Postgres treats NULLs as distinct, so UNIQUE still holds.
            alter table video_rooms add constraint video_rooms_host_token_unique    unique (host_token);
            alter table video_rooms add constraint video_rooms_monitor_token_unique unique (monitor_token);

            -- slug is unique per academy among live rooms (kebab-case enforced app-side).
            create unique index video_rooms_academy_slug_uq
                on video_rooms (academy_id, lower(slug))
             where slug is not null and deleted_at is null;
        SQL);

        // --- readers (new functions: create as app, then hand ownership to bypass) -
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

            create or replace function app.video_room_by_slug(p_academy text, p_slug text)
            returns json
            language plpgsql
            stable
            security definer
            set search_path = public, app, pg_catalog
            as $$
            declare
                v_room record;
            begin
                select r.id, r.academy_id, r.livekit_name, r.name, r.status, r.config
                  into v_room
                  from video_rooms r
                  join academies a on a.id = r.academy_id
                 where lower(a.subdomain) = lower(p_academy)
                   and lower(r.slug) = lower(p_slug)
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
                    'link_role',    'guest'
                );
            end;
            $$;
        SQL);

        // The slug reader joins academies, so the definer needs SELECT on it (idempotent).
        DB::unprepared("grant select on academies to {$bypass};");

        foreach (['app.video_room_by_access_token(text)', 'app.video_room_by_slug(text, text)'] as $fn) {
            DB::unprepared("alter function {$fn} owner to {$bypass};");
            DB::unprepared("revoke all on function {$fn} from public;");
            DB::unprepared("grant execute on function {$fn} to {$app};");
        }
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.video_room_by_access_token(text);');
        DB::unprepared('drop function if exists app.video_room_by_slug(text, text);');
        DB::unprepared(<<<'SQL'
            drop index if exists video_rooms_academy_slug_uq;
            alter table video_rooms drop constraint if exists video_rooms_host_token_unique;
            alter table video_rooms drop constraint if exists video_rooms_monitor_token_unique;
            alter table video_rooms drop column if exists slug;
            alter table video_rooms drop column if exists host_token;
            alter table video_rooms drop column if exists monitor_token;
        SQL);
    }
};
