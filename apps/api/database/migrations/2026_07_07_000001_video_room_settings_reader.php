<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Room access settings, S1 (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §4/§6.1). Per-room
 * settings (optional passwords, waiting room, recording gate, host-present gate, mute-on-join,
 * guest-screenshare gate, max participants, monitor-enabled) live in the EXISTING `video_rooms.config`
 * JSONB — no table change. But the public join endpoint carries no tenant context, so it must read
 * those settings through the context-free reader. This migration only widens
 * `app.video_room_by_join_token()` to also return `config`, so VideoJoinController can enforce the
 * settings server-side without a raw cross-tenant read (V-TEN-1).
 *
 * The function is owned by the BYPASSRLS role (SECURITY DEFINER), so only that role may replace it —
 * the migration runner (academiq_app) is a member of the bypass role (that membership is how the
 * original join_token migration could `alter function ... owner to <bypass>`), so we `set role` to
 * the owner to CREATE OR REPLACE in place, then re-assert the EXECUTE grant, then reset.
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

        DB::unprepared("set role {$bypass};");
        DB::unprepared(<<<'SQL'
            create or replace function app.video_room_by_join_token(p_token text)
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
                 where r.join_token = p_token
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
                    'config',       v_room.config
                );
            end;
            $$;
        SQL);
        DB::unprepared('revoke all on function app.video_room_by_join_token(text) from public;');
        DB::unprepared("grant execute on function app.video_room_by_join_token(text) to {$app};");
        DB::unprepared('reset role;');
    }

    public function down(): void
    {
        $bypass = $this->role('bypass_role');
        $app = $this->role('app_role');

        // Restore the original 5-field payload (without config).
        DB::unprepared("set role {$bypass};");
        DB::unprepared(<<<'SQL'
            create or replace function app.video_room_by_join_token(p_token text)
            returns json
            language plpgsql
            stable
            security definer
            set search_path = public, app, pg_catalog
            as $$
            declare
                v_room record;
            begin
                select r.id, r.academy_id, r.livekit_name, r.name, r.status
                  into v_room
                  from video_rooms r
                 where r.join_token = p_token
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
                    'status',       v_room.status
                );
            end;
            $$;
        SQL);
        DB::unprepared('revoke all on function app.video_room_by_join_token(text) from public;');
        DB::unprepared("grant execute on function app.video_room_by_join_token(text) to {$app};");
        DB::unprepared('reset role;');
    }
};
