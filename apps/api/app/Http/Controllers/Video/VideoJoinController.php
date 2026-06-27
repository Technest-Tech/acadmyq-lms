<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
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

    public function __construct(private readonly LivekitTokenService $tokens) {}

    public function join(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'display_name' => ['sometimes', 'nullable', 'string', 'max:80'],
        ]);

        $room = $this->resolveRoom($token);
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $academyId = (string) $room['academy_id'];
        $livekitName = (string) $room['livekit_name'];

        // Optional auth: a logged-in host vs an anonymous guest. The Sanctum guard returns null
        // for an unauthenticated request (verified), so this never forces a login.
        $user = Auth::guard('sanctum')->user();
        $host = $user !== null ? $this->resolveHost((string) $user->getKey(), $academyId) : null;

        if ($host !== null) {
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
            // Unguessable per-join identity so each guest is a distinct LiveKit participant and the
            // attendance row is uniquely keyed (never a `users` row — they have no account).
            $identity = 'guest-'.Str::lower(Str::random(16));
            $accessToken = $this->tokens->guestToken($livekitName, $identity, $displayName);
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
