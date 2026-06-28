<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video\Concerns;

use Illuminate\Support\Facades\DB;

/**
 * Resolve a room from one of its shareable link tokens via the BYPASSRLS SECURITY DEFINER reader
 * `app.video_room_by_access_token()` — the same context-free path VideoJoinController uses. Lets the
 * token-authenticated host actions (waiting room, moderation, recording) work from the no-login host
 * link alone: possession of the room's `host_token` IS the authority (08-ROOM-ACCESS §13.5), no
 * session required. Never a raw cross-tenant read (V-TEN-1).
 */
trait ResolvesRoomByToken
{
    /**
     * Decode the reader's JSON DTO; null when the token matches no ACTIVE room.
     *
     * @return array<string,mixed>|null
     */
    protected function roomByAccessToken(string $token): ?array
    {
        $raw = DB::selectOne('select app.video_room_by_access_token(?) as data', [$token])->data ?? null;
        if ($raw === null) {
            return null;
        }

        $dto = is_string($raw) ? json_decode($raw, true) : (array) $raw;

        return empty($dto) ? null : $dto;
    }

    /**
     * Resolve a room from its manage credential (the room's host_token), requiring the matched link to
     * be the HOST link. A guest/monitor token — or an unknown one — is rejected 403 the same way (we
     * don't distinguish missing from wrong-role, to blunt token enumeration).
     *
     * @return array<string,mixed>
     */
    protected function requireHostRoomByToken(string $manageToken): array
    {
        $room = $this->roomByAccessToken($manageToken);
        if ($room === null || (string) ($room['link_role'] ?? '') !== 'host') {
            abort(response()->json(['code' => 'manage_forbidden', 'message' => 'Invalid host link.'], 403));
        }

        return $room;
    }
}
