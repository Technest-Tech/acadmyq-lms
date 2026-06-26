<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Shareable per-room join links (docs/video-platform/06-WEB-CALL-CLIENT §2). Adds an
 * unguessable `join_token` to video_rooms so a room can be opened from the browser at
 * `/r/{join_token}` — the Zoom-style "one link, two joiner types" model: a logged-in teacher
 * becomes the host, an anonymous student becomes a guest.
 *
 * A request to the public join endpoint carries NO tenant context, so RLS hides the room. We
 * resolve it through `app.video_room_by_join_token(text)` — a SECURITY DEFINER reader owned by
 * the BYPASSRLS role, exactly the escape-hatch pattern used by app.public_invoice_by_token and
 * app.role_capabilities (custom_roles §7). The function only ever returns an ACTIVE, non-deleted
 * room, and only the five fields the join flow needs — never a raw cross-tenant read (V-TEN-1).
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

        // --- the join_token column ------------------------------------------------
        // Add nullable, backfill every existing row with an unguessable value (the md5
        // construction mirrors the invoicing-engine public_token safety-net backfill), then
        // harden to UNIQUE + NOT NULL. New rooms get a token from VideoJoinToken at creation.
        // Backfill runs as the table owner (academiq_app). video_rooms is FORCE RLS and a
        // migration carries no tenant context, so a plain UPDATE matches zero (tenant-hidden)
        // rows on a populated DB and the SET NOT NULL below would then fail. Drop FORCE for the
        // backfill only — the owner is then RLS-exempt and keeps full DML rights — refill, then
        // restore FORCE. The whole migration is transactional, so a failure cannot leave FORCE off.
        DB::unprepared(<<<'SQL'
            alter table video_rooms add column join_token text;

            alter table video_rooms no force row level security;
            update video_rooms
               set join_token = md5(id::text || random()::text || clock_timestamp()::text)
             where join_token is null;
            alter table video_rooms force row level security;

            alter table video_rooms alter column join_token set not null;
            alter table video_rooms add constraint video_rooms_join_token_unique unique (join_token);
        SQL);

        // --- context-free room lookup (SECURITY DEFINER, BYPASSRLS) --------------
        // The public join endpoint has no Sanctum user and no tenant GUCs, so a plain SELECT on
        // video_rooms is hidden by FORCE RLS. This function runs with the definer's rights and
        // returns only a curated payload for an ACTIVE room — the same shape app.public_invoice_*
        // uses. Anyone holding the link can resolve the room (that is the shareable-link model),
        // but they get nothing about any other room or tenant.
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

        // The definer (BYPASSRLS) role must OWN the function for SECURITY DEFINER to run with its
        // rights, and needs SELECT on the table it reads. EXECUTE is granted only to the app role.
        DB::unprepared("grant select on video_rooms to {$bypass};");
        DB::unprepared("alter function app.video_room_by_join_token(text) owner to {$bypass};");
        DB::unprepared('revoke all on function app.video_room_by_join_token(text) from public;');
        DB::unprepared("grant execute on function app.video_room_by_join_token(text) to {$app};");
    }

    public function down(): void
    {
        DB::unprepared('drop function if exists app.video_room_by_join_token(text);');
        DB::unprepared(<<<'SQL'
            alter table video_rooms drop constraint if exists video_rooms_join_token_unique;
            alter table video_rooms drop column if exists join_token;
        SQL);
    }
};
