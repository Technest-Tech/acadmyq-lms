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
 * Public join-by-link endpoint (docs/video-platform/06-WEB-CALL-CLIENT §2) — the browser sibling
 * of the authenticated `/video/rooms/{id}/token` flow. ONE shareable link `/r/{join_token}`,
 * TWO joiner types:
 *
 *   - Authenticated HOST: a logged-in user who holds `room.join` in the room's academy joins with
 *     their identity (and `roomAdmin` iff they hold `room.manage`).
 *   - Anonymous GUEST: a student/parent with no account types a display name and joins with
 *     publish+subscribe ONLY — never admin/record (V-SEC-1, realises V-ACC-2 as a copy-paste link).
 *
 * The route is NOT Sanctum-gated and carries no tenant context, so the room is resolved through the
 * SECURITY DEFINER `app.video_room_by_join_token()` (never a raw cross-tenant read, V-TEN-1) and the
 * attendance row is written inside `Tenancy::withContext` — the same discipline LivekitWebhook uses.
 * Throttled at the route (like `/i/{token}`) to blunt token enumeration.
 */
final class VideoJoinController extends Controller
{
    /** Synthetic actor for the guest attendance write (no Sanctum user present), as in the webhook. */
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(
        private readonly LivekitTokenService $tokens,
        private readonly LivekitRoomClient $rooms,
    ) {}

    public function join(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'display_name' => ['sometimes', 'nullable', 'string', 'max:80'],
            'password' => ['sometimes', 'nullable', 'string', 'max:64'],
        ]);

        $room = $this->resolveRoom($token);
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $academyId = (string) $room['academy_id'];
        $livekitName = (string) $room['livekit_name'];
        $config = $this->parseConfig($room['config'] ?? null);

        // Optional auth: a logged-in host vs an anonymous guest. The Sanctum guard returns null
        // for an unauthenticated request (verified), so this never forces a login.
        $user = Auth::guard('sanctum')->user();
        $host = $user !== null ? $this->resolveHost((string) $user->getKey(), $academyId) : null;

        if ($host !== null) {
            // An identity-verified host bypasses guest passwords / presence / capacity gates — those
            // only guard the public guest path (08-ROOM-ACCESS §4).
            $identity = (string) $user->getKey();
            $displayName = trim((string) ($user->full_name ?? ''));
            $accessToken = $this->tokens->accessToken($livekitName, $identity, $displayName, $host['canManage']);
            $role = 'host';

            $this->recordParticipant($academyId, (string) $room['room_id'], $identity, $displayName, [
                'ctxUserId' => $identity,
                'ctxRole' => $host['role'],
                'userId' => $identity,
                'participantRole' => 'HOST',
            ]);
        } else {
            $displayName = trim((string) ($data['display_name'] ?? ''));
            if ($displayName === '') {
                abort(422, 'A display name is required to join.');
            }

            // Enforce the room's guest gates server-side before minting a token (V-SEC-1): optional
            // password, then the host-present / capacity checks (best-effort, fail-open on SFU error).
            $this->enforceGuestPassword($config, $request);
            $this->enforceGuestPresenceAndCapacity($config, $livekitName);

            // Unguessable per-join identity so each guest is a distinct LiveKit participant and the
            // attendance row is uniquely keyed (never a `users` row — they have no account).
            $identity = 'guest-'.Str::lower(Str::random(16));
            $allowScreenshare = (bool) ($config['allow_guest_screenshare'] ?? true);
            $accessToken = $this->tokens->guestToken($livekitName, $identity, $displayName, $allowScreenshare);
            $role = 'guest';

            $this->recordParticipant($academyId, (string) $room['room_id'], $identity, $displayName, [
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
            'roomId' => (string) $room['room_id'],
            'identity' => $identity,
            'displayName' => $displayName !== '' ? $displayName : null,
            'role' => $role,
            // Host admin capability (room.manage): gates the in-call record control AND moderation
            // (mute/remove/end). Guests and hosts without room.manage get false.
            'canManage' => $host !== null && ($host['canManage'] ?? false),
            // Settings the client honours (never the password values): the record button is also
            // gated by recording_enabled; guests start muted when mute_guests_on_join; and the
            // monitor disclosure notice shows when the room may be supervised (08-ROOM-ACCESS §4/§5).
            'recordingEnabled' => (bool) ($config['recording_enabled'] ?? true),
            'muteOnJoin' => $role === 'guest' && (bool) ($config['mute_guests_on_join'] ?? false),
            'monitorDisclosure' => (bool) ($config['monitor_enabled'] ?? false),
        ]);
    }

    /** Resolve the room from the join token via the BYPASSRLS reader; null if missing/archived. */
    private function resolveRoom(string $token): ?array
    {
        $rows = DB::select('select app.video_room_by_join_token(?) as data', [$token]);
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
