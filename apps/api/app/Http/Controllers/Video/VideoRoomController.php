<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Services\Livekit\LivekitRoomClient;
use App\Services\Livekit\LivekitTokenService;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\VideoJoinToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

        $rooms = DB::table('video_rooms')
            ->whereNull('deleted_at')
            ->orderByDesc('created_at')
            ->get(['id', 'name', 'teacher_id', 'status', 'record_default', 'join_token', 'host_token', 'slug', 'config', 'created_at'])
            ->map(fn (object $r) => $this->withConfig($r));

        return response()->json(['rooms' => $rooms]);
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
            'record_default' => ['sometimes', 'boolean'],
            'session_id' => ['sometimes', 'nullable', 'uuid'],
            'slug' => ['sometimes', 'nullable', 'string', 'min:4', 'max:40', 'regex:/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/'],
        ]);

        if (! empty($data['teacher_id']) && DB::table('teachers')->where('id', $data['teacher_id'])->whereNull('deleted_at')->doesntExist()) {
            abort(422, 'Unknown or inactive teacher.');
        }

        $config = array_merge($this->defaultConfig(), $this->validateSettings($request));
        $slug = $request->has('slug') ? $this->resolveSlug($request, $academyId, $config, null) : null;

        $id = (string) Str::uuid();
        DB::table('video_rooms')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'teacher_id' => $data['teacher_id'] ?? null,
            'name' => $data['name'],
            'livekit_name' => $this->makeLivekitName($academyId),
            'join_token' => VideoJoinToken::generate(),
            'host_token' => VideoJoinToken::generateSecret(),
            'monitor_token' => VideoJoinToken::generateSecret(),
            'slug' => $slug,
            'record_default' => (bool) ($data['record_default'] ?? false),
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

        return response()->json(['room' => $this->withConfig($room)]);
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
            'record_default' => ['sometimes', 'boolean'],
            'status' => ['sometimes', Rule::in(['ACTIVE', 'ARCHIVED'])],
            'slug' => ['sometimes', 'nullable', 'string', 'min:4', 'max:40', 'regex:/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/'],
        ]);

        // Settings live in the config JSONB — merge the provided keys over the existing config
        // (defaults backfilled for any room created before settings existed).
        $existing = is_string($room->config) ? (array) json_decode($room->config, true) : (array) ($room->config ?? []);
        $settings = $this->validateSettings($request);
        $mergedConfig = array_merge($this->defaultConfig(), $existing, $settings);
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
        $column = match ($which) {
            'guest' => 'join_token',
            'host' => 'host_token',
            default => abort(422, 'Unknown link type.'),
        };
        $token = $which === 'guest' ? VideoJoinToken::generate() : VideoJoinToken::generateSecret();

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
    private function withConfig(object $row): object
    {
        $stored = (array) json_decode((string) ($row->config ?? '{}'), true);
        $row->config = (object) array_merge($this->defaultConfig(), $stored);
        // The monitor link is private to management (gated by room.monitor in S3) — never expose its
        // token through the room.read list/detail surfaces. show() selects every column, so strip it.
        unset($row->monitor_token);

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
     * a guest password — waiting room becomes a valid alternative in S4), and that the slug is unique
     * within the academy. Aborts 422 with a code on any violation.
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

        if (($config['guest_password'] ?? null) === null) {
            abort(response()->json(['code' => 'slug_needs_password', 'message' => 'A room slug needs a guest password to be safe.'], 422));
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
     * A globally-unique LiveKit room name that carries the academy id as a `__<uuid>` suffix, so
     * the (context-free) webhook can resolve the tenant from the room name before entering its
     * RLS context (03-DATA-MODEL §3 / LivekitWebhookController).
     */
    private function makeLivekitName(string $academyId): string
    {
        return 'r-'.substr((string) Str::uuid(), 0, 8).'__'.$academyId;
    }
}
