<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Services\Livekit\LivekitRoomClient;
use App\Services\Livekit\LivekitTokenService;
use App\Support\AuthContext;
use App\Support\PermissionResolver;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Public join-by-link endpoint (docs/video-platform/06 + 08-ROOM-ACCESS §2) — the browser sibling of
 * the authenticated `/video/rooms/{id}/token` flow. Role-separated links resolve to grants:
 *
 *   - Authenticated HOST (strongest): a logged-in user holding `room.join` in the room's academy
 *     joins with their identity (roomAdmin iff they hold `room.manage`), regardless of the link used.
 *   - HOST link (no-login): the room's private high-entropy `host_token` → host with roomAdmin,
 *     behind the optional host password.
 *   - GUEST link: the short slug `/r/{academy}/{room}` or the `join_token` → publish+subscribe only,
 *     behind the optional guest password (V-SEC-1, realises V-ACC-2 as a copy-paste link).
 *   - MONITOR link: the private `monitor_token` → supervisor mode (wired in S3).
 *
 * The routes are NOT Sanctum-gated and carry no tenant context, so the room is resolved through the
 * SECURITY DEFINER readers `app.video_room_by_access_token()` / `app.video_room_by_slug()` (never a
 * raw cross-tenant read, V-TEN-1) and the attendance row is written inside `Tenancy::withContext` —
 * the same discipline LivekitWebhook uses. Throttled at the route to blunt token enumeration.
 */
final class VideoJoinController extends Controller
{
    /** Synthetic actor for the guest attendance write (no Sanctum user present), as in the webhook. */
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(
        private readonly LivekitTokenService $tokens,
        private readonly LivekitRoomClient $rooms,
    ) {}

    /** POST /api/video/join/{token} — join via a guest / host / monitor token link. */
    public function join(Request $request, string $token): JsonResponse
    {
        $room = $this->resolveRoom($token);
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        return $this->performJoin($request, $room);
    }

    /**
     * POST /api/video/join-slug/{academy}/{room} — the readable guest link /r/{academy}/{room}
     * (08-ROOM-ACCESS §3). Resolves the room from the academy subdomain + slug (always a guest link).
     */
    public function joinBySlug(Request $request, string $academy, string $room): JsonResponse
    {
        $resolved = $this->resolveRoomBySlug($academy, $room);
        if ($resolved === null) {
            abort(404, 'Room not found.');
        }

        return $this->performJoin($request, $resolved);
    }

    /**
     * Shared join core for every link type. Role precedence (08-ROOM-ACCESS §2): an authenticated host
     * (identity-verified, strongest path) ALWAYS wins regardless of the link used; otherwise the link's
     * own role decides — a host link → host (roomAdmin, behind the optional host password); a monitor
     * link → supervisor mode (wired in S3, rejected here); else a guest (behind the optional guest
     * password + presence/capacity gates). All grants are minted server-side (V-SEC-1).
     *
     * @param  array<string,mixed>  $room
     */
    private function performJoin(Request $request, array $room): JsonResponse
    {
        $data = $request->validate([
            'display_name' => ['sometimes', 'nullable', 'string', 'max:80'],
            'password' => ['sometimes', 'nullable', 'string', 'max:64'],
        ]);

        $academyId = (string) $room['academy_id'];
        $roomId = (string) $room['room_id'];
        $livekitName = (string) $room['livekit_name'];
        $config = $this->parseConfig($room['config'] ?? null);
        $linkRole = (string) ($room['link_role'] ?? 'guest');

        // A logged-in host overrides the link. The Sanctum guard returns null for an unauthenticated
        // request (verified), so this never forces a login.
        $user = Auth::guard('sanctum')->user();
        $authHost = $user !== null ? $this->resolveHost((string) $user->getKey(), $academyId) : null;

        if ($authHost !== null) {
            // Identity-verified host — bypasses every link gate (passwords/presence/capacity).
            $identity = (string) $user->getKey();
            $displayName = trim((string) ($user->full_name ?? ''));
            $canManage = (bool) $authHost['canManage'];
            $role = 'host';
            $accessToken = $this->tokens->accessToken($livekitName, $identity, $displayName, $canManage);

            $this->recordParticipant($academyId, $roomId, $identity, $displayName, [
                'ctxUserId' => $identity,
                'ctxRole' => $authHost['role'],
                'userId' => $identity,
                'participantRole' => 'HOST',
            ]);
        } elseif ($linkRole === 'host') {
            // No-login host link: a shared secret granting full control (roomAdmin), behind the
            // optional host password.
            $this->enforceHostPassword($config, $request);
            $displayName = trim((string) ($data['display_name'] ?? '')) ?: 'Host';
            $identity = 'host-'.Str::lower(Str::random(16));
            $canManage = true;
            $role = 'host';
            $accessToken = $this->tokens->accessToken($livekitName, $identity, $displayName, true);

            $this->recordParticipant($academyId, $roomId, $identity, $displayName, [
                'ctxUserId' => self::SYSTEM_USER_ID,
                'ctxRole' => 'SUPER_ADMIN',
                'userId' => null,
                'participantRole' => 'HOST',
            ]);
        } elseif ($linkRole === 'monitor') {
            // Supervisor mode is wired in S3 (room.monitor cap + hidden grant + audit + disclosure).
            abort(response()->json(['code' => 'monitor_unavailable', 'message' => 'Monitor mode is not available yet.'], 403));
        } else {
            $displayName = trim((string) ($data['display_name'] ?? ''));
            if ($displayName === '') {
                abort(422, 'A display name is required to join.');
            }

            // Guest gates, server-side before minting (V-SEC-1): optional password, then the
            // host-present / capacity checks (best-effort, fail-open on SFU error).
            $this->enforceGuestPassword($config, $request);
            $this->enforceGuestPresenceAndCapacity($config, $livekitName);

            $identity = 'guest-'.Str::lower(Str::random(16));
            $allowScreenshare = (bool) ($config['allow_guest_screenshare'] ?? true);
            $canManage = false;
            $role = 'guest';
            $accessToken = $this->tokens->guestToken($livekitName, $identity, $displayName, $allowScreenshare);

            $this->recordParticipant($academyId, $roomId, $identity, $displayName, [
                'ctxUserId' => self::SYSTEM_USER_ID,
                'ctxRole' => 'SUPER_ADMIN', // system context for the tenant write (mirrors the webhook)
                'userId' => null,
                'participantRole' => 'PARTICIPANT',
            ]);
        }

        return response()->json([
            'url' => (string) config('services.livekit.host'),
            'token' => $accessToken,
            'roomName' => $livekitName,
            'roomTitle' => (string) $room['name'],
            'roomId' => $roomId,
            'identity' => $identity,
            'displayName' => $displayName !== '' ? $displayName : null,
            'role' => $role,
            // Host admin capability: gates the in-call record control AND moderation (mute/remove/end).
            'canManage' => $canManage,
            // Settings the client honours (never the password values): record is also gated by
            // recording_enabled; guests start muted when mute_guests_on_join; the monitor disclosure
            // notice shows when the room may be supervised (08-ROOM-ACCESS §4/§5).
            'recordingEnabled' => (bool) ($config['recording_enabled'] ?? true),
            'muteOnJoin' => $role === 'guest' && (bool) ($config['mute_guests_on_join'] ?? false),
            'monitorDisclosure' => (bool) ($config['monitor_enabled'] ?? false),
        ]);
    }

    /**
     * Resolve a room from any access token (join/host/monitor) via the BYPASSRLS reader, including the
     * matched `link_role`; null if missing/archived. Never a raw cross-tenant read (V-TEN-1).
     */
    private function resolveRoom(string $token): ?array
    {
        return $this->decodeRoom(DB::select('select app.video_room_by_access_token(?) as data', [$token]));
    }

    /** Resolve a room from its academy subdomain + slug (always a guest link); null if missing. */
    private function resolveRoomBySlug(string $academy, string $slug): ?array
    {
        return $this->decodeRoom(DB::select('select app.video_room_by_slug(?, ?) as data', [$academy, $slug]));
    }

    /**
     * @param  array<int,object>  $rows
     * @return array<string,mixed>|null
     */
    private function decodeRoom(array $rows): ?array
    {
        $raw = $rows[0]->data ?? null;
        if ($raw === null) {
            return null;
        }

        $dto = is_string($raw) ? json_decode($raw, true) : (array) $raw;

        return empty($dto) ? null : $dto;
    }

    /**
     * Decode the room's settings (the reader embeds the config JSONB as nested JSON, so it usually
     * arrives already-decoded as an array; tolerate a raw string too).
     *
     * @return array<string,mixed>
     */
    private function parseConfig(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);

            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    /** Optional per-room guest password (08-ROOM-ACCESS §4) — constant-time compared; OFF when null. */
    private function enforceGuestPassword(array $config, Request $request): void
    {
        $expected = $config['guest_password'] ?? null;
        if (! is_string($expected) || $expected === '') {
            return;
        }

        $supplied = (string) $request->input('password', '');
        if ($supplied === '') {
            // Distinct codes so the lobby can show a password field vs. an "incorrect" error.
            abort(response()->json(['code' => 'password_required', 'message' => 'This room requires a password.'], 422));
        }
        if (! hash_equals($expected, $supplied)) {
            abort(response()->json(['code' => 'password_incorrect', 'message' => 'Incorrect room password.'], 422));
        }
    }

    /** Optional per-room HOST-link password (08-ROOM-ACCESS §4) — only guards the no-login host link. */
    private function enforceHostPassword(array $config, Request $request): void
    {
        $expected = $config['host_password'] ?? null;
        if (! is_string($expected) || $expected === '') {
            return;
        }

        $supplied = (string) $request->input('password', '');
        if ($supplied === '') {
            abort(response()->json(['code' => 'password_required', 'message' => 'This room requires a password.'], 422));
        }
        if (! hash_equals($expected, $supplied)) {
            abort(response()->json(['code' => 'password_incorrect', 'message' => 'Incorrect room password.'], 422));
        }
    }

    /**
     * require_host_present + max_participants. Both read the SFU's live participant list once, and are
     * BEST-EFFORT: a transient SFU error fails OPEN (allow the join) rather than locking out a class.
     * Hidden monitors (08-ROOM-ACCESS §5) never count toward capacity.
     */
    private function enforceGuestPresenceAndCapacity(array $config, string $livekitName): void
    {
        $requireHost = (bool) ($config['require_host_present'] ?? false);
        $max = $config['max_participants'] ?? null;
        $max = is_numeric($max) ? (int) $max : null;
        if (! $requireHost && ($max === null || $max <= 0)) {
            return;
        }

        $list = $this->rooms->listParticipants($livekitName);
        if (! $list['ok']) {
            return; // fail-open
        }
        $participants = $list['participants'];

        if ($requireHost && ! $this->hasLiveHost($participants)) {
            abort(response()->json(['code' => 'host_absent', 'message' => 'Waiting for the teacher to start the class.'], 409));
        }
        if ($max !== null && $max > 0 && $this->countJoinable($participants) >= $max) {
            abort(response()->json(['code' => 'room_full', 'message' => 'This room is full.'], 409));
        }
    }

    /** The `role` carried in a participant's LiveKit metadata (host|guest|monitor), or null. */
    private function participantRole(array $participant): ?string
    {
        $meta = (string) ($participant['metadata'] ?? '');
        if ($meta === '') {
            return null;
        }
        $decoded = json_decode($meta, true);

        return is_array($decoded) && isset($decoded['role']) ? (string) $decoded['role'] : null;
    }

    private function hasLiveHost(array $participants): bool
    {
        foreach ($participants as $p) {
            if ($this->participantRole((array) $p) === 'host') {
                return true;
            }
        }

        return false;
    }

    /** Count participants who occupy a seat — everyone except hidden monitors. */
    private function countJoinable(array $participants): int
    {
        $count = 0;
        foreach ($participants as $p) {
            if ($this->participantRole((array) $p) !== 'monitor') {
                $count++;
            }
        }

        return $count;
    }

    /**
     * Is this authenticated user a host of the room's academy? They are iff they hold a role
     * assignment in that academy whose capabilities include `room.join`. Returns the role + whether
     * they also hold `room.manage` (→ roomAdmin), or null (→ treat as a guest). Reads roles through
     * the BYPASSRLS `app.auth_user_roles()` because no tenant context is set on this route.
     *
     * @return array{role: string, canManage: bool}|null
     */
    private function resolveHost(string $userId, string $academyId): ?array
    {
        $roles = DB::select('select role, academy_id from app.auth_user_roles(?::uuid)', [$userId]);

        foreach ($roles as $r) {
            if ($r->academy_id === null || (string) $r->academy_id !== $academyId) {
                continue;
            }
            $caps = PermissionResolver::forRole($r->role);
            if (in_array('room.join', $caps, true)) {
                return ['role' => (string) $r->role, 'canManage' => in_array('room.manage', $caps, true)];
            }
        }

        return null;
    }

    /**
     * Write the attendance row (room_participants) inside the room's tenant context. Idempotent:
     * one OPEN row per (room, identity) — a reconnect with the same identity does not duplicate.
     *
     * @param  array{ctxUserId: string, ctxRole: string, userId: ?string, participantRole: string}  $opts
     */
    private function recordParticipant(string $academyId, string $roomId, string $identity, string $displayName, array $opts): void
    {
        $ctx = new AuthContext($opts['ctxUserId'], $academyId, $opts['ctxRole'], []);

        Tenancy::withContext($ctx, function () use ($academyId, $roomId, $identity, $displayName, $opts): void {
            $open = DB::table('room_participants')
                ->where('room_id', $roomId)
                ->where('identity', $identity)
                ->whereNull('left_at')
                ->exists();
            if ($open) {
                return;
            }

            DB::table('room_participants')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'room_id' => $roomId,
                'identity' => $identity,
                'display_name' => $displayName !== '' ? $displayName : null,
                'user_id' => $opts['userId'],
                'role' => $opts['participantRole'],
                'joined_at' => now(),
            ]);
        });
    }
}
