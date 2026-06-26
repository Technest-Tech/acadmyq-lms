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
            ->get(['id', 'name', 'teacher_id', 'status', 'record_default', 'join_token', 'created_at']);

        return response()->json(['rooms' => $rooms]);
    }

    /** POST /api/video/rooms — provision a room (owner action; V-CTL-1). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('room.create');

        $ctx = $this->ctx();
        $academyId = (string) $ctx->academyId;

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'record_default' => ['sometimes', 'boolean'],
            'session_id' => ['sometimes', 'nullable', 'uuid'],
        ]);

        if (! empty($data['teacher_id']) && DB::table('teachers')->where('id', $data['teacher_id'])->whereNull('deleted_at')->doesntExist()) {
            abort(422, 'Unknown or inactive teacher.');
        }

        $id = (string) Str::uuid();
        DB::table('video_rooms')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'teacher_id' => $data['teacher_id'] ?? null,
            'name' => $data['name'],
            'livekit_name' => $this->makeLivekitName($academyId),
            'join_token' => VideoJoinToken::generate(),
            'record_default' => (bool) ($data['record_default'] ?? false),
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

        return response()->json(['room' => $room]);
    }

    /** PATCH /api/video/rooms/{id} — rename / retitle / toggle record-default. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'record_default' => ['sometimes', 'boolean'],
            'status' => ['sometimes', Rule::in(['ACTIVE', 'ARCHIVED'])],
        ]);
        if ($data === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('video_rooms')->where('id', $id)->update($data + ['updated_at' => now()]);
        Audit::log('video_room.update', 'video_room', $id, (string) $this->ctx()->academyId, $this->ctx()->userId, $this->ctx()->role, after: $data);

        return response()->json(['ok' => true, 'changed' => array_keys($data)]);
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
     * POST /api/video/rooms/{id}/rotate-link — regenerate the shareable join_token, invalidating
     * any previously-shared link (a `room.manage` action; V-CTL-1). Returns the fresh token.
     */
    public function rotate(string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $token = VideoJoinToken::generate();
        DB::table('video_rooms')->where('id', $id)->update(['join_token' => $token, 'updated_at' => now()]);
        Audit::log('video_room.rotate_link', 'video_room', $id, (string) $this->ctx()->academyId, $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['join_token' => $token]);
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
