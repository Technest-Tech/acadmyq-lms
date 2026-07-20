<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Services\Livekit\LivekitRoomClient;
use App\Services\Livekit\LivekitTokenService;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\PermissionResolver;
use App\Support\Tenancy;
use App\Support\VideoJoinToken;
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
     * POST /api/video/knock/{knockToken} — the waiting guest's short-poll (08-ROOM-ACCESS §13.6).
     * Public + context-free, so the knock is read through the SECURITY DEFINER reader. While PENDING
     * it reports `knocking`; once a host admits, THIS endpoint mints the guest token + writes the
     * attendance row (so the token only ever lives in the admitted guest's own response).
     */
    public function knockStatus(Request $request, string $knockToken): JsonResponse
    {
        $knock = $this->decodeRoom(DB::select('select app.video_knock_status(?) as data', [$knockToken]));
        if ($knock === null) {
            abort(404, 'Knock not found.');
        }

        $status = (string) ($knock['status'] ?? '');
        if ($status === 'PENDING') {
            return response()->json(['state' => 'knocking']);
        }
        if ($status === 'DENIED') {
            return response()->json(['state' => 'denied']);
        }
        if ($status !== 'ADMITTED') {
            // EXPIRED (or any unexpected terminal state) — the guest must knock again.
            return response()->json(['state' => 'expired']);
        }

        // Admitted — the host's explicit admit IS the gate, so presence/capacity are not re-checked
        // here (re-running require_host_present would contradict the admit). Mint with the identity
        // pre-allocated at knock time so a re-poll is idempotent (attendance dedupes on identity).
        $config = $this->parseConfig($knock['config'] ?? null);
        $academyId = (string) $knock['academy_id'];
        $roomId = (string) $knock['room_id'];
        $livekitName = (string) $knock['livekit_name'];
        $identity = (string) $knock['identity'];
        $displayName = (string) ($knock['display_name'] ?? '');

        // A ghost-waiting-room knock is admitted as a HIDDEN monitor (never a visible guest) — the host
        // consented to an observer, so we mint the monitor token and audit the entry, no attendance row.
        if ((string) ($knock['role'] ?? 'guest') === 'monitor') {
            return $this->admitMonitorKnock($knock, $config, $academyId, $roomId, $livekitName, $identity, $displayName);
        }

        $allowScreenshare = (bool) ($config['allow_guest_screenshare'] ?? true);

        $accessToken = $this->tokens->guestToken($livekitName, $identity, $displayName, $allowScreenshare);

        $this->recordParticipant($academyId, $roomId, $identity, $displayName, [
            'ctxUserId' => self::SYSTEM_USER_ID,
            'ctxRole' => 'SUPER_ADMIN',
            'userId' => null,
            'participantRole' => 'PARTICIPANT',
        ]);

        return response()->json([
            'state' => 'admitted',
            'url' => (string) config('services.livekit.host'),
            'token' => $accessToken,
            'roomName' => $livekitName,
            'roomTitle' => (string) $knock['name'],
            'roomId' => $roomId,
            'identity' => $identity,
            'displayName' => $displayName !== '' ? $displayName : null,
            'role' => 'guest',
            'canManage' => false,
            'manageToken' => null,
            'recordingEnabled' => (bool) ($config['recording_enabled'] ?? true),
            'muteOnJoin' => (bool) ($config['mute_guests_on_join'] ?? false),
            'monitorDisclosure' => (bool) ($config['monitor_enabled'] ?? false) && (bool) ($config['monitor_disclose'] ?? true),
            'suppressRecordingIndicator' => (bool) ($config['monitor_enabled'] ?? false) && ! (bool) ($config['monitor_disclose'] ?? true),
        ]);
    }

    /**
     * Admit a ghost-waiting-room knock as a HIDDEN monitor (08-ROOM-ACCESS §13). Mirrors the immediate
     * monitor branch of performJoin, but fires at the moment the host admits — so `monitor_join` is
     * audited when the observer truly enters (naming the signed-in watcher, or an anonymous link use),
     * carrying the actor recorded at knock time. No attendance row: a monitor is a ghost.
     *
     * @param  array<string,mixed>  $knock
     * @param  array<string,mixed>  $config
     */
    private function admitMonitorKnock(array $knock, array $config, string $academyId, string $roomId, string $livekitName, string $identity, string $displayName): JsonResponse
    {
        $accessToken = $this->tokens->monitorToken($livekitName, $identity, $displayName !== '' ? $displayName : null);

        $actorUserId = ($knock['actor_user_id'] ?? null) !== null ? (string) $knock['actor_user_id'] : null;
        $actorRole = (string) ($knock['actor_role'] ?? '') ?: 'MONITOR_LINK';
        Audit::log('video_room.monitor_join', 'video_room', $roomId, $academyId, $actorUserId, $actorRole, after: [
            'livekit_name' => $livekitName,
            'via' => 'ghost_waiting_room',
        ]);

        return response()->json([
            'state' => 'admitted',
            'url' => (string) config('services.livekit.host'),
            'token' => $accessToken,
            'roomName' => $livekitName,
            'roomTitle' => (string) $knock['name'],
            'roomId' => $roomId,
            'identity' => $identity,
            'displayName' => $displayName !== '' ? $displayName : null,
            'role' => 'monitor',
            'canManage' => false,
            'manageToken' => null,
            'recordingEnabled' => (bool) ($config['recording_enabled'] ?? true),
            'muteOnJoin' => false,
            'monitorDisclosure' => (bool) ($config['monitor_enabled'] ?? false) && (bool) ($config['monitor_disclose'] ?? true),
            'suppressRecordingIndicator' => (bool) ($config['monitor_enabled'] ?? false) && ! (bool) ($config['monitor_disclose'] ?? true),
        ]);
    }

    /**
     * GET /api/video/manage/{manageToken}/knocks — the host's pending-knock queue (08-ROOM-ACCESS
     * §13.5). Authenticated by the manage credential (= the room's host_token), so the no-login host
     * link works as well as a logged-in manager. Lists only fresh PENDING knocks (≤ the 15-min TTL).
     */
    public function listKnocks(Request $request, string $manageToken): JsonResponse
    {
        $room = $this->resolveHostRoom($manageToken);

        return response()->json(['knocks' => $this->readPendingKnocks((string) $room['academy_id'], (string) $room['room_id'])]);
    }

    /**
     * POST /api/video/manage/{manageToken}/knocks/{knockId} — admit or deny a knocker (08-ROOM-ACCESS
     * §13.5). Idempotent: only a PENDING knock transitions; a settled one returns its current status.
     * Always audited (who decided, which room).
     */
    public function decideKnock(Request $request, string $manageToken, string $knockId): JsonResponse
    {
        $room = $this->resolveHostRoom($manageToken);
        $data = $request->validate(['decision' => ['required', 'in:admit,deny']]);

        $academyId = (string) $room['academy_id'];
        $roomId = (string) $room['room_id'];
        $decider = Auth::guard('sanctum')->user();
        $deciderId = $decider !== null ? (string) $decider->getKey() : null;
        $newStatus = $data['decision'] === 'admit' ? 'ADMITTED' : 'DENIED';

        $applied = $this->decideKnockRow($academyId, $roomId, $knockId, $newStatus, $deciderId);
        if ($applied === null) {
            abort(404, 'Knock not found.');
        }

        Audit::log(
            $data['decision'] === 'admit' ? 'video_room.knock_admit' : 'video_room.knock_deny',
            'video_room', $roomId, $academyId, $deciderId, $deciderId !== null ? 'MANAGER' : 'HOST_LINK',
            after: ['knock_id' => $knockId, 'status' => $applied],
        );

        return response()->json(['ok' => true, 'status' => $applied]);
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

        // The waiting-room manage credential (08-ROOM-ACCESS §13.5): the room's host_token, handed to
        // any host-role joiner so they can run the knock queue. Null for guests/monitors.
        $manageToken = null;

        if ($linkRole === 'monitor') {
            // Supervisor mode — an explicit HIDDEN entry that OVERRIDES the auth-host default (using
            // the monitor link is a deliberate choice to be invisible, not to appear as host). The
            // monitor link is a shared secret like the host link: ANYONE holding it joins as a ghost,
            // NO login required (08-ROOM-ACCESS §5). The only gate is the room being monitor-enabled.
            // ALWAYS audited — with the signed-in identity when present, else an anonymous link entry.
            if (! (bool) ($config['monitor_enabled'] ?? false)) {
                abort(response()->json(['code' => 'monitor_disabled', 'message' => 'Monitor mode is not enabled for this room.'], 403));
            }
            // Supervisor mode is also a PLAN feature (FeatureCatalog `monitorAllowed`, fail open): a
            // plan can switch it off even on a monitor-enabled room. Resolved in the academy's context
            // (this public route sets none, and academies/academy_addons are RLS-scoped).
            if (! $this->planFlag($academyId, 'monitorAllowed')) {
                abort(response()->json(['code' => 'monitor_disabled', 'message' => 'Monitor mode is not available on this academy\'s plan.'], 403));
            }

            if ($user !== null) {
                $identity = (string) $user->getKey();
                $displayName = trim((string) ($user->full_name ?? ''));
                $auditActor = $identity;
                $auditRole = $this->resolveMonitor($identity, $academyId) ?? 'MEMBER';
            } else {
                $identity = 'monitor-'.Str::lower(Str::random(16));
                $displayName = trim((string) ($data['display_name'] ?? ''));
                $auditActor = null;
                $auditRole = 'MONITOR_LINK';
            }

            // Ghost waiting room (08-ROOM-ACCESS §13): when enabled, even a hidden observer must be
            // admitted by the host before entering — mint NOTHING, record a monitor knock, and return
            // the "knocking" state. The host's queue surfaces it (labelled as an observer); on admit,
            // knockStatus() mints the monitor token and audits the entry (the true "watched" moment).
            // This is the female-teacher consent gate: no ghost enters her room without her say-so.
            if ((bool) ($config['ghost_waiting_room'] ?? false)) {
                $knockToken = VideoJoinToken::generateSecret();
                $this->recordKnock($academyId, $roomId, $knockToken, $identity, $displayName, [
                    'role' => 'monitor',
                    'actorUserId' => $auditActor,
                    'actorRole' => $auditRole,
                ]);

                return response()->json([
                    'state' => 'knocking',
                    'knockToken' => $knockToken,
                    'roomId' => $roomId,
                    'roomTitle' => (string) $room['name'],
                ]);
            }

            $canManage = false;
            $role = 'monitor';
            $accessToken = $this->tokens->monitorToken($livekitName, $identity, $displayName !== '' ? $displayName : null);

            // Accountability is mandatory even when covert — record WHO watched (or that the link was
            // used anonymously), WHICH room, WHEN.
            Audit::log('video_room.monitor_join', 'video_room', $roomId, $academyId, $auditActor, $auditRole, after: ['livekit_name' => $livekitName]);
            // No attendance row — a monitor is a ghost; its presence lives only in the audit log.
        } elseif ($authHost !== null) {
            // Identity-verified host — bypasses every link gate (passwords/presence/capacity).
            $identity = (string) $user->getKey();
            $displayName = trim((string) ($user->full_name ?? ''));
            $canManage = (bool) $authHost['canManage'];
            $role = 'host';
            $manageToken = ($room['host_token'] ?? null) ?: null;
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
            $manageToken = ($room['host_token'] ?? null) ?: null;
            $accessToken = $this->tokens->accessToken($livekitName, $identity, $displayName, true);

            $this->recordParticipant($academyId, $roomId, $identity, $displayName, [
                'ctxUserId' => self::SYSTEM_USER_ID,
                'ctxRole' => 'SUPER_ADMIN',
                'userId' => null,
                'participantRole' => 'HOST',
            ]);
        } else {
            $displayName = trim((string) ($data['display_name'] ?? ''));
            if ($displayName === '') {
                abort(422, 'A display name is required to join.');
            }

            // Guest gates, server-side before minting (V-SEC-1): optional password first (you must know
            // it to even knock), then the waiting room, then the host-present / capacity checks.
            $this->enforceGuestPassword($config, $request);

            // Waiting room (08-ROOM-ACCESS §13): mint NOTHING — record a knock and return the
            // "knocking" state. The guest short-polls knockStatus() until a host admits (auth-host,
            // host link and monitor sit above this branch, so they bypass the wait entirely).
            if ((bool) ($config['waiting_room'] ?? false)) {
                $identity = 'guest-'.Str::lower(Str::random(16));
                $knockToken = VideoJoinToken::generateSecret();
                $this->recordKnock($academyId, $roomId, $knockToken, $identity, $displayName);

                return response()->json([
                    'state' => 'knocking',
                    'knockToken' => $knockToken,
                    'roomId' => $roomId,
                    'roomTitle' => (string) $room['name'],
                ]);
            }

            $this->enforceGuestPresenceAndCapacity($config, $livekitName, $academyId);

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
            // Waiting-room manage credential (08-ROOM-ACCESS §13.5) — present only for host-role joiners
            // so the client can poll/admit the knock queue; null for guests and monitors.
            'manageToken' => $manageToken,
            // Settings the client honours (never the password values): record is also gated by
            // recording_enabled; guests start muted when mute_guests_on_join. Monitor disclosure
            // (08-ROOM-ACCESS §5): when a room may be supervised AND disclosure is on, joiners see a
            // "may be monitored & recorded" notice. In COVERT mode (monitor_disclose=false) the notice
            // is hidden AND the recording indicator is suppressed — the academy owns that legal call.
            'recordingEnabled' => (bool) ($config['recording_enabled'] ?? true),
            'muteOnJoin' => $role === 'guest' && (bool) ($config['mute_guests_on_join'] ?? false),
            'monitorDisclosure' => (bool) ($config['monitor_enabled'] ?? false) && (bool) ($config['monitor_disclose'] ?? true),
            'suppressRecordingIndicator' => (bool) ($config['monitor_enabled'] ?? false) && ! (bool) ($config['monitor_disclose'] ?? true),
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
    private function enforceGuestPresenceAndCapacity(array $config, string $livekitName, string $academyId): void
    {
        $requireHost = (bool) ($config['require_host_present'] ?? false);
        // The effective seat cap is the tighter of the room's own `max_participants` and the plan's
        // `maxRoomParticipants` (FeatureCatalog) — either may be null (uncapped); we take the min.
        $roomMax = is_numeric($config['max_participants'] ?? null) ? (int) $config['max_participants'] : null;
        $planMax = $this->planLimit($academyId, 'maxRoomParticipants');
        $max = match (true) {
            $roomMax !== null && $planMax !== null => min($roomMax, $planMax),
            default => $roomMax ?? $planMax,
        };
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
     * Does this authenticated user hold `room.monitor` in the room's academy? Returns the granting
     * role (for the audit trail), or null. Reads roles through the BYPASSRLS `app.auth_user_roles()`
     * because no tenant context is set on this public route — same discipline as resolveHost().
     */
    private function resolveMonitor(string $userId, string $academyId): ?string
    {
        $roles = DB::select('select role, academy_id from app.auth_user_roles(?::uuid)', [$userId]);

        foreach ($roles as $r) {
            if ($r->academy_id === null || (string) $r->academy_id !== $academyId) {
                continue;
            }
            if (in_array('room.monitor', PermissionResolver::forRole($r->role), true)) {
                return (string) $r->role;
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

    /**
     * Record a PENDING knock inside the room's tenant context (same context-free-write discipline as
     * recordParticipant). The knocker gets back only the knock_token; no LiveKit token is minted yet.
     * `opts` tags the knock with the role to mint on admit ('guest' default, or 'monitor' for a ghost
     * waiting room) and, for a monitor, the audit actor recorded so the entry names WHO watched.
     *
     * @param  array{role?: string, actorUserId?: ?string, actorRole?: ?string}  $opts
     */
    private function recordKnock(string $academyId, string $roomId, string $knockToken, string $identity, string $displayName, array $opts = []): void
    {
        $ctx = new AuthContext(self::SYSTEM_USER_ID, $academyId, 'SUPER_ADMIN', []);

        Tenancy::withContext($ctx, function () use ($academyId, $roomId, $knockToken, $identity, $displayName, $opts): void {
            DB::table('room_knocks')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'room_id' => $roomId,
                'knock_token' => $knockToken,
                'identity' => $identity,
                'display_name' => $displayName,
                'status' => 'PENDING',
                'role' => $opts['role'] ?? 'guest',
                'actor_user_id' => $opts['actorUserId'] ?? null,
                'actor_role' => $opts['actorRole'] ?? null,
            ]);
        });
    }

    /**
     * Resolve a plan FLAG (FeatureCatalog, fail open) for an academy inside its own tenant context —
     * this public route sets none, and academies/academy_addons are RLS-scoped, so a context-free
     * read would see no plan and silently fail open. Mirrors recordKnock's context discipline.
     */
    private function planFlag(string $academyId, string $key): bool
    {
        $ctx = new AuthContext(self::SYSTEM_USER_ID, $academyId, 'SUPER_ADMIN', []);

        return Tenancy::withContext($ctx, fn (): bool => Entitlement::flagFor($academyId, $key));
    }

    /** Resolve a plan numeric LIMIT for an academy inside its tenant context (see planFlag). */
    private function planLimit(string $academyId, string $key): ?int
    {
        $ctx = new AuthContext(self::SYSTEM_USER_ID, $academyId, 'SUPER_ADMIN', []);

        return Tenancy::withContext($ctx, fn (): ?int => Entitlement::limitFor($academyId, $key));
    }

    /**
     * Resolve a room from its manage credential (the host_token) for the knock-management endpoints,
     * requiring the matched link to be the HOST link (a guest/monitor token, or an unknown one, is
     * rejected 403 — we don't distinguish missing from wrong-role, to avoid token enumeration).
     *
     * @return array<string,mixed>
     */
    private function resolveHostRoom(string $manageToken): array
    {
        $room = $this->resolveRoom($manageToken);
        if ($room === null || (string) ($room['link_role'] ?? '') !== 'host') {
            abort(response()->json(['code' => 'manage_forbidden', 'message' => 'Invalid host link.'], 403));
        }

        return $room;
    }

    /**
     * The room's pending queue (fresh PENDING knocks only, ≤ the 15-min TTL), read inside the room's
     * tenant context.
     *
     * @return array<int,array{id:string,displayName:string,role:string,createdAt:string}>
     */
    private function readPendingKnocks(string $academyId, string $roomId): array
    {
        $ctx = new AuthContext(self::SYSTEM_USER_ID, $academyId, 'SUPER_ADMIN', []);

        return Tenancy::withContext($ctx, function () use ($roomId): array {
            return DB::table('room_knocks')
                ->where('room_id', $roomId)
                ->where('status', 'PENDING')
                ->where('created_at', '>', now()->subMinutes(15))
                ->orderBy('created_at')
                ->get(['id', 'display_name', 'role', 'created_at'])
                ->map(fn (object $k): array => [
                    'id' => (string) $k->id,
                    'displayName' => (string) $k->display_name,
                    // 'guest' (student) or 'monitor' (a hidden observer awaiting consent) — lets the
                    // host queue label a ghost knock distinctly from a student one.
                    'role' => (string) ($k->role ?? 'guest'),
                    'createdAt' => (string) $k->created_at,
                ])
                ->all();
        });
    }

    /**
     * Apply an admit/deny decision inside the room's tenant context. Idempotent: only a PENDING knock
     * transitions; a settled knock returns its current status; a missing knock returns null (→ 404).
     */
    private function decideKnockRow(string $academyId, string $roomId, string $knockId, string $newStatus, ?string $deciderId): ?string
    {
        $ctx = new AuthContext(self::SYSTEM_USER_ID, $academyId, 'SUPER_ADMIN', []);

        return Tenancy::withContext($ctx, function () use ($roomId, $knockId, $newStatus, $deciderId): ?string {
            $knock = DB::table('room_knocks')->where('id', $knockId)->where('room_id', $roomId)->first();
            if ($knock === null) {
                return null;
            }
            if ((string) $knock->status !== 'PENDING') {
                return (string) $knock->status; // already settled — idempotent
            }

            DB::table('room_knocks')->where('id', $knockId)->update([
                'status' => $newStatus,
                'decided_by' => $deciderId,
                'decided_at' => now(),
                'updated_at' => now(),
            ]);

            return $newStatus;
        });
    }
}
