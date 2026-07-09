<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Services\Livekit\LivekitRoomClient;
use App\Services\Livekit\LivekitTokenService;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\VideoJoinToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Video rooms — the academy-owned classroom (V-CTL-1). Every route is plan-gated upstream by
 * `entitled:video.conferencing` (402 on a miss) and capability-gated here by Gate::authorize
 * (403 on a miss); all reads/writes are tenant-scoped by RLS. The `token` endpoint is the trust
 * boundary (01-ARCHITECTURE §3): it mints a short-lived LiveKit access token whose grant is
 * derived from the caller's capabilities — never an admin/recording grant for a plain joiner.
 */
final class VideoRoomController extends Controller
{
    public function __construct(
        private readonly LivekitTokenService $tokens,
        private readonly LivekitRoomClient $rooms,
    ) {}

    /** GET /api/video/rooms — the academy's rooms (RLS-scoped). */
    public function index(): JsonResponse
    {
        Gate::authorize('room.read');

        // One subdomain for the whole list (RLS scopes every room to the caller's academy).
        $subdomain = DB::table('academies')->where('id', (string) $this->ctx()->academyId)->value('subdomain');
        $canMonitor = $this->ctx()->can('room.monitor');

        $rooms = DB::table('video_rooms')
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->get(['id', 'name', 'teacher_id', 'status', 'join_token', 'host_token', 'monitor_token', 'slug', 'config', 'created_at'])
            ->map(fn (object $r) => $this->withConfig($r, $subdomain, $canMonitor));

        return response()->json(['rooms' => $rooms]);
    }

    /**
     * GET /api/video/rooms/presence — live occupancy for the academy's rooms, keyed by room id.
     *
     * A single ListRooms probe tells us which of this academy's rooms are live on the SFU; each
     * occupied room then gets ONE ListParticipants call for detail (per-person camera/mic/screen +
     * aggregate tallies). Hidden supervisors (monitors) never appear in the occupant list or the
     * count — they surface only as a `monitors` tally, and only to viewers holding room.monitor.
     * Fail-open: any SFU hiccup yields an empty map so the room list still renders. Empty rooms are
     * omitted, so the frontend can poll this cheaply and only paint the rooms that have someone in.
     */
    public function presence(): JsonResponse
    {
        Gate::authorize('room.read');
        $canMonitor = $this->ctx()->can('room.monitor');

        // livekit_name → room id for this academy's non-archived rooms (RLS scopes to the caller).
        $roomsByLivekitName = DB::table('video_rooms')
            ->whereNull('deleted_at')
            ->pluck('id', 'livekit_name');

        if ($roomsByLivekitName->isEmpty()) {
            return response()->json(['presence' => (object) []]);
        }

        // One cheap ListRooms call → live SFU room names with their participant counts. Only rooms
        // the SFU reports as occupied are worth a per-room detail call.
        $live = $this->rooms->listRooms();
        $liveCounts = [];
        if ($live['ok']) {
            foreach ($live['rooms'] as $r) {
                $r = (array) $r;
                $name = (string) ($r['name'] ?? '');
                if ($name !== '') {
                    $liveCounts[$name] = (int) ($r['numParticipants'] ?? $r['num_participants'] ?? 0);
                }
            }
        }

        $presence = [];
        foreach ($roomsByLivekitName as $livekitName => $roomId) {
            if (($liveCounts[(string) $livekitName] ?? 0) <= 0) {
                continue; // empty (or unreachable) → omit
            }
            $list = $this->rooms->listParticipants((string) $livekitName);
            if (! $list['ok']) {
                continue;
            }
            $summary = $this->summarizePresence($list['participants'], $canMonitor);
            if ($summary['count'] > 0 || $summary['monitors'] > 0) {
                $presence[(string) $roomId] = $summary;
            }
        }

        return response()->json(['presence' => $presence ?: (object) []]);
    }

    /**
     * Reduce a raw LiveKit participant list to a card-ready presence summary. A track counts as "on"
     * only when it is published AND unmuted (camera/mic); a screen-share counts whenever the track is
     * present. Monitors are dropped from the occupant list + counts, contributing only to `monitors`.
     * Occupants are ordered host-first, then by join time.
     *
     * @param  array<int,mixed>  $participants
     * @return array{count:int,monitors:int,camerasOn:int,micsOn:int,screenSharing:int,participants:array<int,array<string,mixed>>}
     */
    private function summarizePresence(array $participants, bool $canMonitor): array
    {
        $people = [];
        $monitors = 0;

        foreach ($participants as $p) {
            $p = (array) $p;
            // A lingering DISCONNECTED entry can briefly appear — only count the truly connected.
            $state = strtoupper((string) ($p['state'] ?? ''));
            if ($state !== '' && ! in_array($state, ['ACTIVE', 'JOINED'], true)) {
                continue;
            }
            if ($this->participantRole($p) === 'monitor') {
                $monitors++;

                continue;
            }

            $camera = false;
            $mic = false;
            $screen = false;
            foreach ((array) ($p['tracks'] ?? []) as $track) {
                $track = (array) $track;
                $type = strtoupper((string) ($track['type'] ?? ''));
                $source = strtoupper((string) ($track['source'] ?? ''));
                $muted = (bool) ($track['muted'] ?? false);
                if (str_contains($source, 'SCREEN')) {
                    $screen = true;
                } elseif ($source === 'CAMERA' || ($source === '' && $type === 'VIDEO')) {
                    $camera = $camera || ! $muted;
                } elseif ($source === 'MICROPHONE' || ($source === '' && $type === 'AUDIO')) {
                    $mic = $mic || ! $muted;
                }
            }

            $joinedAt = $p['joinedAt'] ?? $p['joined_at'] ?? null;
            $identity = (string) ($p['identity'] ?? '');
            $people[] = [
                'identity' => $identity,
                'name' => ((string) ($p['name'] ?? '')) ?: $identity,
                'role' => $this->participantRole($p) === 'host' ? 'host' : 'guest',
                'camera' => $camera,
                'mic' => $mic,
                'screen' => $screen,
                'joinedAt' => $joinedAt !== null ? (int) $joinedAt : null,
            ];
        }

        usort($people, function (array $a, array $b): int {
            if ($a['role'] !== $b['role']) {
                return $a['role'] === 'host' ? -1 : 1;
            }

            return ($a['joinedAt'] ?? 0) <=> ($b['joinedAt'] ?? 0);
        });

        return [
            'count' => count($people),
            'monitors' => $canMonitor ? $monitors : 0,
            'camerasOn' => count(array_filter($people, static fn (array $x): bool => $x['camera'])),
            'micsOn' => count(array_filter($people, static fn (array $x): bool => $x['mic'])),
            'screenSharing' => count(array_filter($people, static fn (array $x): bool => $x['screen'])),
            'participants' => $people,
        ];
    }

    /** The `role` (host|guest|monitor) carried in a participant's LiveKit metadata, or null. */
    private function participantRole(array $participant): ?string
    {
        $meta = (string) ($participant['metadata'] ?? '');
        if ($meta === '') {
            return null;
        }
        $decoded = json_decode($meta, true);

        return is_array($decoded) && isset($decoded['role']) ? (string) $decoded['role'] : null;
    }

    /** POST /api/video/rooms — provision a room (owner action; V-CTL-1). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('room.create');

        $ctx = $this->ctx();
        $academyId = (string) $ctx->academyId;

        $this->normalizeSlugInput($request);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'session_id' => ['sometimes', 'nullable', 'uuid'],
            'slug' => ['sometimes', 'nullable', 'string', 'min:4', 'max:40', 'regex:/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/'],
        ]);

        if (! empty($data['teacher_id']) && DB::table('teachers')->where('id', $data['teacher_id'])->whereNull('deleted_at')->doesntExist()) {
            abort(422, 'Unknown or inactive teacher.');
        }

        // Plan room cap (FeatureCatalog `maxRooms`). Counts the academy's live (non-archived) rooms;
        // unlimited when the plan sets no cap (fail open). A 402 keeps "plan limit" distinct from 403.
        $activeRooms = (int) DB::table('video_rooms')->where('academy_id', $academyId)->whereNull('deleted_at')->count();
        if (! Entitlement::withinLimit($ctx, 'maxRooms', $activeRooms)) {
            $cap = Entitlement::limit($ctx, 'maxRooms');
            abort(response()->json([
                'error' => 'plan_limit_reached',
                'code' => 'room_limit_reached',
                'resource' => 'rooms',
                'limit' => $cap,
                'current' => $activeRooms,
                'message' => "You've reached your plan's limit of {$cap} video rooms. Upgrade your plan to add more.",
            ], 402));
        }

        $config = array_merge($this->defaultConfig(), $this->validateSettings($request));
        $this->enforceMonitorEntitlement($ctx, $config);
        // Academy-chosen slugs are retired (08-ROOM-ACCESS §14) but the route still accepts one for
        // back-compat tests/integrations; null when not provided.
        $slug = $request->has('slug') ? $this->resolveSlug($request, $academyId, $config, null) : null;

        // Auto-generated SHORT links (08-ROOM-ACCESS §14): `{kebab-room-name}-{≤7 alnum}`, one per role,
        // each distinct from the others and unique within the academy.
        $links = $this->mintRoomLinks($data['name']);

        $id = (string) Str::uuid();
        DB::table('video_rooms')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'teacher_id' => $data['teacher_id'] ?? null,
            'name' => $data['name'],
            'livekit_name' => $this->makeLivekitName($academyId),
            'join_token' => $links['join_token'],
            'host_token' => $links['host_token'],
            'monitor_token' => $links['monitor_token'],
            'slug' => $slug,
            'config' => json_encode($config),
        ]);
        Audit::log('video_room.create', 'video_room', $id, $academyId, $ctx->userId, $ctx->role, after: [
            'name' => $data['name'],
            'teacher_id' => $data['teacher_id'] ?? null,
        ]);

        return response()->json(['roomId' => $id], 201);
    }

    /** GET /api/video/rooms/{id} — room detail (RLS-scoped). */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('room.read');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $subdomain = DB::table('academies')->where('id', (string) $room->academy_id)->value('subdomain');

        return response()->json(['room' => $this->withConfig($room, $subdomain, $this->ctx()->can('room.monitor'))]);
    }

    /**
     * GET /api/video/rooms/{id}/logs — the room's access log (08-ROOM-ACCESS §15): WHO accessed the
     * room, WHEN they joined/left and for HOW LONG (room_participants), plus every audited action on
     * the room (audit_log), all timestamped. RLS-scoped; gated room.read. A `video_room.monitor_join`
     * event is stripped unless the caller holds room.monitor — covert supervision must not leak to a
     * plain manager via the activity feed (same privacy gate as the monitor_token exposure).
     */
    public function logs(string $id): JsonResponse
    {
        Gate::authorize('room.read');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')
            ->first(['id', 'name', 'status', 'created_at']);
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $cap = 500;

        // Access sessions — the join/leave history written at /join.
        $rawSessions = DB::table('room_participants as rp')
            ->leftJoin('users as u', 'u.id', '=', 'rp.user_id')
            ->where('rp.room_id', $id)
            ->orderByDesc('rp.joined_at')
            ->limit($cap + 1)
            ->get(['rp.id', 'rp.identity', 'rp.display_name', 'rp.user_id', 'u.full_name as user_name', 'rp.role', 'rp.joined_at', 'rp.left_at']);
        $sessionsTruncated = $rawSessions->count() > $cap;
        $sessions = $rawSessions->take($cap)->map(function (object $r): array {
            $joined = $r->joined_at !== null ? Carbon::parse($r->joined_at) : null;
            $left = $r->left_at !== null ? Carbon::parse($r->left_at) : null;
            // Integer-second diff via timestamps — avoids Carbon major-version diff() sign quirks.
            $duration = ($joined !== null && $left !== null) ? max(0, $left->getTimestamp() - $joined->getTimestamp()) : null;

            return [
                'id' => (string) $r->id,
                'identity' => (string) $r->identity,
                'display_name' => $r->display_name,
                'user_id' => $r->user_id,
                'user_name' => $r->user_name,
                'role' => (string) $r->role,
                'joined_at' => $joined?->toIso8601String(),
                'left_at' => $left?->toIso8601String(),
                'duration_s' => $duration,
                'ongoing' => $left === null,
            ];
        })->values()->all();

        // Activity — every audited action on this room. monitor_join is room.monitor-only.
        $canMonitor = $this->ctx()->can('room.monitor');
        $rawEvents = DB::table('audit_log as al')
            ->leftJoin('users as u', 'u.id', '=', 'al.actor_user_id')
            ->where('al.entity_type', 'video_room')
            ->where('al.entity_id', $id)
            ->when(! $canMonitor, fn ($q) => $q->where('al.action', '!=', 'video_room.monitor_join'))
            ->orderByDesc('al.created_at')
            ->limit($cap + 1)
            ->get(['al.id', 'al.action', 'al.actor_user_id', 'u.full_name as actor_name', 'al.actor_role', 'al.after', 'al.created_at']);
        $eventsTruncated = $rawEvents->count() > $cap;
        $events = $rawEvents->take($cap)->map(fn (object $r): array => [
            'id' => (string) $r->id,
            'action' => (string) $r->action,
            'actor_user_id' => $r->actor_user_id,
            'actor_name' => $r->actor_name,
            'actor_role' => $r->actor_role,
            'after' => $r->after !== null ? json_decode($r->after, true) : null,
            'created_at' => Carbon::parse($r->created_at)->toIso8601String(),
        ])->values()->all();

        $uniqueParticipants = collect($sessions)->pluck('identity')->unique()->count();
        $totalSeconds = (int) collect($sessions)->sum(fn (array $s) => $s['duration_s'] ?? 0);

        return response()->json([
            'room' => [
                'id' => (string) $room->id,
                'name' => (string) $room->name,
                'status' => (string) $room->status,
                'created_at' => Carbon::parse($room->created_at)->toIso8601String(),
            ],
            'sessions' => $sessions,
            'events' => $events,
            'stats' => [
                'total_sessions' => count($sessions),
                'unique_participants' => $uniqueParticipants,
                'total_seconds' => $totalSeconds,
                'last_access' => $sessions[0]['joined_at'] ?? null,
            ],
            'truncated' => $sessionsTruncated || $eventsTruncated,
        ]);
    }

    /** PATCH /api/video/rooms/{id} — rename / retitle / toggle record-default. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $this->normalizeSlugInput($request);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'status' => ['sometimes', Rule::in(['ACTIVE', 'ARCHIVED'])],
            'slug' => ['sometimes', 'nullable', 'string', 'min:4', 'max:40', 'regex:/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/'],
        ]);

        // Settings live in the config JSONB — merge the provided keys over the existing config
        // (defaults backfilled for any room created before settings existed).
        $existing = is_string($room->config) ? (array) json_decode($room->config, true) : (array) ($room->config ?? []);
        $settings = $this->validateSettings($request);
        $mergedConfig = array_merge($this->defaultConfig(), $existing, $settings);
        // Block turning monitor mode ON when the plan doesn't include it (no-op when it was already on
        // and isn't being changed — only a fresh enable is gated, so we don't trap legacy rooms).
        if (($settings['monitor_enabled'] ?? false) === true) {
            $this->enforceMonitorEntitlement($this->ctx(), $mergedConfig);
        }
        if ($settings !== []) {
            $data['config'] = json_encode($mergedConfig);
        }

        // Slug protection is checked against the FINAL config (a password set in the same request counts).
        if ($request->has('slug')) {
            $data['slug'] = $this->resolveSlug($request, (string) $this->ctx()->academyId, $mergedConfig, $id);
        }

        if ($data === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('video_rooms')->where('id', $id)->update($data + ['updated_at' => now()]);
        // Don't echo raw settings (passwords) into the audit trail — record only which keys changed.
        $changed = array_keys($data);
        Audit::log('video_room.update', 'video_room', $id, (string) $this->ctx()->academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'fields' => $changed,
            'settings' => array_keys($settings),
        ]);

        return response()->json(['ok' => true, 'changed' => $changed]);
    }

    /** DELETE /api/video/rooms/{id} — archive (soft-delete) + best-effort SFU teardown. */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        DB::table('video_rooms')->where('id', $id)->update([
            'status' => 'ARCHIVED',
            'deleted_at' => now(),
            'updated_at' => now(),
        ]);
        // Best-effort: kick anyone still connected on the SFU (returns false if unreachable).
        $this->rooms->deleteRoom((string) $room->livekit_name);

        Audit::log('video_room.delete', 'video_room', $id, (string) $this->ctx()->academyId, $this->ctx()->userId, $this->ctx()->role, before: ['name' => $room->name]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/video/rooms/{id}/token — mint a scoped LiveKit access token for the caller. */
    public function token(string $id): JsonResponse
    {
        Gate::authorize('room.join');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $ctx = $this->ctx();
        $displayName = (string) (DB::table('users')->where('id', $ctx->userId)->value('full_name') ?? '');
        $canManage = $ctx->can('room.manage');

        $token = $this->tokens->accessToken((string) $room->livekit_name, $ctx->userId, $displayName, $canManage);

        return response()->json([
            'url' => (string) config('services.livekit.host'),
            'token' => $token,
            'room' => $room->livekit_name,
            'identity' => $ctx->userId,
        ]);
    }

    /**
     * POST /api/video/rooms/{id}/rotate-link — regenerate one of the room's shareable links,
     * invalidating its previously-shared URL (a `room.manage` action; V-CTL-1). Body `{ which:
     * 'guest'|'host' }` (default 'guest'; monitor rotation arrives with S3's room.monitor gate).
     */
    public function rotate(Request $request, string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $which = (string) $request->input('which', 'guest');
        // Rotating the private monitor link is itself a management action (room.monitor).
        if ($which === 'monitor') {
            Gate::authorize('room.monitor');
        }
        $column = match ($which) {
            'guest' => 'join_token',
            'host' => 'host_token',
            'monitor' => 'monitor_token',
            default => abort(422, 'Unknown link type.'),
        };
        // A rotated link stays a SHORT link (08-ROOM-ACCESS §14), distinct from the room's other links.
        $token = $this->uniqueRoomToken((string) $room->name, [
            (string) $room->join_token,
            (string) ($room->host_token ?? ''),
            (string) ($room->monitor_token ?? ''),
        ]);

        DB::table('video_rooms')->where('id', $id)->update([$column => $token, 'updated_at' => now()]);
        Audit::log('video_room.rotate_link', 'video_room', $id, (string) $this->ctx()->academyId, $this->ctx()->userId, $this->ctx()->role, after: ['which' => $which]);

        // Return both a generic `token` and the column-named key (back-compat with the guest default).
        return response()->json(['which' => $which, 'token' => $token, $column => $token]);
    }

    /**
     * Decode a room's config JSONB into a full settings object (defaults backfilled), so the panel
     * always sees every key regardless of when the room was created. The query builder returns jsonb
     * as a raw string, so we decode it explicitly here.
     */
    private function withConfig(object $row, ?string $subdomain = null, bool $canMonitor = false): object
    {
        $stored = (array) json_decode((string) ($row->config ?? '{}'), true);
        $row->config = (object) array_merge($this->defaultConfig(), $stored);
        // The monitor link is private to management — expose its token ONLY to room.monitor holders
        // (08-ROOM-ACCESS §5); strip it for everyone else (a plain teacher with room.read must not see it).
        if (! $canMonitor) {
            unset($row->monitor_token);
        }
        // The academy subdomain lets the panel build the readable slug URL (/r/{academy}/{slug}).
        $row->academy_subdomain = $subdomain;

        return $row;
    }

    /**
     * Per-room access settings (08-ROOM-ACCESS §4), stored in the config JSONB. Defaults preserve
     * today's behaviour: no passwords, recording allowed for managing hosts, guests may screen-share,
     * no caps, monitor off. Every password is OPTIONAL.
     *
     * @return array<string,mixed>
     */
    private function defaultConfig(): array
    {
        return [
            'guest_password' => null,
            'host_password' => null,
            'waiting_room' => false,
            'recording_enabled' => true,
            'require_host_present' => false,
            'mute_guests_on_join' => false,
            'allow_guest_screenshare' => true,
            'max_participants' => null,
            'monitor_enabled' => false,
            // Disclose monitoring to participants (safe default). Set false for COVERT supervision —
            // the academy owns that legal call (08-ROOM-ACCESS §5); entry is audited regardless.
            'monitor_disclose' => true,
        ];
    }

    /**
     * Validate and return only the settings keys present in the request's `settings` object. Passwords
     * are optional (null clears them); an empty-string password is normalised to null (no password).
     *
     * @return array<string,mixed>
     */
    private function validateSettings(Request $request): array
    {
        if (! $request->has('settings')) {
            return [];
        }

        // An empty-string password means "no password" — normalise to null BEFORE validation so the
        // min-length rule never trips on a deliberate clear (enforcement then only ever sees null|string).
        $raw = (array) $request->input('settings', []);
        foreach (['guest_password', 'host_password'] as $pw) {
            if (array_key_exists($pw, $raw) && $raw[$pw] === '') {
                $raw[$pw] = null;
            }
        }
        $request->merge(['settings' => $raw]);

        $request->validate([
            'settings' => ['array'],
            'settings.guest_password' => ['sometimes', 'nullable', 'string', 'min:4', 'max:64'],
            'settings.host_password' => ['sometimes', 'nullable', 'string', 'min:4', 'max:64'],
            'settings.waiting_room' => ['sometimes', 'boolean'],
            'settings.recording_enabled' => ['sometimes', 'boolean'],
            'settings.require_host_present' => ['sometimes', 'boolean'],
            'settings.mute_guests_on_join' => ['sometimes', 'boolean'],
            'settings.allow_guest_screenshare' => ['sometimes', 'boolean'],
            'settings.max_participants' => ['sometimes', 'nullable', 'integer', 'min:2', 'max:500'],
            'settings.monitor_enabled' => ['sometimes', 'boolean'],
            'settings.monitor_disclose' => ['sometimes', 'boolean'],
        ]);

        $allowed = array_keys($this->defaultConfig());

        return array_intersect_key($raw, array_flip($allowed));
    }

    /** Lower-case + trim a provided slug, normalising "" to null (clear), before validation. */
    private function normalizeSlugInput(Request $request): void
    {
        if (! $request->has('slug')) {
            return;
        }
        $slug = $request->input('slug');
        if (is_string($slug)) {
            $slug = Str::lower(trim($slug));
            $request->merge(['slug' => $slug === '' ? null : $slug]);
        }
    }

    /**
     * Resolve a (already format-validated) slug for a room: null clears it; otherwise enforce that the
     * academy has a subdomain to namespace the URL, that the room is protected (a guessable slug needs
     * a guest password OR the waiting room — S4), and that the slug is unique within the academy.
     * Aborts 422 with a code on any violation.
     */
    private function resolveSlug(Request $request, string $academyId, array $config, ?string $roomId): ?string
    {
        $slug = $request->input('slug');
        if ($slug === null || $slug === '') {
            return null;
        }
        $slug = Str::lower(trim((string) $slug));

        $subdomain = DB::table('academies')->where('id', $academyId)->value('subdomain');
        if ($subdomain === null || $subdomain === '') {
            abort(response()->json(['code' => 'slug_needs_subdomain', 'message' => 'Set an academy subdomain before using a room slug.'], 422));
        }

        // A guessable slug is only safe when each entrant is gated — by a guest password OR the waiting
        // room (every knocker is admitted by a human). S4 broadens the S2 "needs password" rule.
        if (($config['guest_password'] ?? null) === null && ! (bool) ($config['waiting_room'] ?? false)) {
            abort(response()->json(['code' => 'slug_needs_password_or_waiting', 'message' => 'A room slug needs a guest password or the waiting room to be safe.'], 422));
        }

        $taken = DB::table('video_rooms')
            ->where('academy_id', $academyId)
            ->whereRaw('lower(slug) = ?', [$slug])
            ->whereNull('deleted_at')
            ->when($roomId !== null, fn ($q) => $q->where('id', '!=', $roomId))
            ->exists();
        if ($taken) {
            abort(response()->json(['code' => 'slug_taken', 'message' => 'That slug is already used by another room.'], 422));
        }

        return $slug;
    }

    private function ctx(): AuthContext
    {
        return app(AuthContext::class);
    }

    /**
     * Supervisor mode is a plan feature (FeatureCatalog `monitorAllowed`, fail open). Reject enabling
     * it on a room whose academy's plan excludes it — a 403 (your plan doesn't include this), so the
     * monitor join never has to half-work.
     *
     * @param  array<string,mixed>  $config
     */
    private function enforceMonitorEntitlement(AuthContext $ctx, array $config): void
    {
        if (($config['monitor_enabled'] ?? false) === true && ! Entitlement::flag($ctx, 'monitorAllowed')) {
            abort(response()->json([
                'code' => 'monitor_not_in_plan',
                'message' => "Your plan doesn't include supervisor (monitor) mode.",
            ], 403));
        }
    }

    /**
     * Mint the trio of auto-generated SHORT links for a new room (08-ROOM-ACCESS §14): one per role
     * (guest/host/monitor), each `{kebab-room-name}-{≤7 alnum}`, all distinct from one another.
     *
     * @return array{join_token: string, host_token: string, monitor_token: string}
     */
    private function mintRoomLinks(string $name): array
    {
        $taken = [];
        $links = [];
        foreach (['join_token', 'host_token', 'monitor_token'] as $col) {
            $token = $this->uniqueRoomToken($name, $taken);
            $taken[] = $token;
            $links[$col] = $token;
        }

        return $links;
    }

    /**
     * A short room link (`{kebab-name}-{≤7 alnum}`) that collides neither with `$avoid` (the room's
     * other links being minted in the same request) nor with any live room's token in this academy
     * (RLS scopes the lookup). Cross-academy collisions are caught by the columns' UNIQUE constraints
     * — the ≤7-char random code makes them astronomically unlikely, so a handful of tries is plenty.
     *
     * @param  array<int,string>  $avoid
     */
    private function uniqueRoomToken(string $name, array $avoid): string
    {
        for ($i = 0; $i < 8; $i++) {
            $token = VideoJoinToken::forRoom($name);
            if (in_array($token, $avoid, true)) {
                continue;
            }
            $clashes = DB::table('video_rooms')
                ->whereNull('deleted_at')
                ->where(fn ($q) => $q->where('join_token', $token)
                    ->orWhere('host_token', $token)
                    ->orWhere('monitor_token', $token))
                ->exists();
            if (! $clashes) {
                return $token;
            }
        }

        // Astronomically-unlikely fallback (8 straight collisions): extra entropy guarantees termination.
        return VideoJoinToken::forRoom($name.'-'.VideoJoinToken::code());
    }

    /**
     * A globally-unique LiveKit room name that carries the academy id as a `__<uuid>` suffix, so
     * the (context-free) webhook can resolve the tenant from the room name before entering its
     * RLS context (03-DATA-MODEL §3 / LivekitWebhookController).
     */
    private function makeLivekitName(string $academyId): string
    {
        return 'r-'.substr((string) Str::uuid(), 0, 8).'__'.$academyId;
    }
}
