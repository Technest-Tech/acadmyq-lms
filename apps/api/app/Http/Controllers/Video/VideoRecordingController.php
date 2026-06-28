<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Video\Concerns\ResolvesRoomByToken;
use App\Services\Livekit\LivekitEgressClient;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Recordings — on-demand only (V-REC-1). Start/stop are owner/manager actions (room.manage);
 * listing/replay requires recording.view. Starting kicks off a LiveKit Egress and writes a
 * STARTING row; the egress webhook later finalises it (LivekitWebhookController). Retention is
 * stamped at creation (V-REC-2) and enforced by PurgeExpiredRecordingsJob. Replay is a short-lived
 * presigned GET URL (`recording.view`); storage access is signed-URL only (V-SEC-2).
 */
final class VideoRecordingController extends Controller
{
    use ResolvesRoomByToken;

    /** Synthetic actor for the no-login host-link recording writes (no Sanctum user present). */
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly LivekitEgressClient $egress) {}

    /** GET /api/video/recordings — list recordings (RLS-scoped), optionally for one room. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('recording.view');

        $query = DB::table('room_recordings')->orderByDesc('created_at');
        if ($request->filled('room_id')) {
            $query->where('room_id', (string) $request->query('room_id'));
        }

        return response()->json([
            'recordings' => $query->get(['id', 'room_id', 'session_id', 'student_id', 'status', 'duration_s', 'bytes', 'started_at', 'ended_at', 'expires_at', 'created_at']),
        ]);
    }

    /**
     * GET /api/video/recordings/{id}/url — a short-lived presigned GET URL for a COMPLETED
     * recording (V-SEC-2: storage is signed-URL only). RLS scopes the lookup to the caller's
     * academy, so a recording from another tenant simply 404s.
     */
    public function url(string $id): JsonResponse
    {
        Gate::authorize('recording.view');

        $rec = DB::table('room_recordings')
            ->where('id', $id)
            ->where('status', 'COMPLETED')
            ->whereNotNull('storage_key')
            ->first();
        if ($rec === null) {
            abort(404, 'Recording not available.');
        }

        $url = Storage::disk('video_recordings')->temporaryUrl(
            (string) $rec->storage_key,
            now()->addMinutes(15),
        );

        return response()->json(['url' => $url]);
    }

    /**
     * DELETE /api/video/recordings/{id} — permanently delete a recording (a management action,
     * room.manage). Stops a still-running egress so it isn't orphaned, best-effort removes the stored
     * object (signed-URL-only storage, V-SEC-2), then deletes the row. RLS scopes the lookup, so a
     * cross-tenant id simply 404s. Audited.
     */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        $rec = DB::table('room_recordings')->where('id', $id)->first();
        if ($rec === null) {
            abort(404, 'Recording not found.');
        }

        // Stop a still-running egress first so deleting the row doesn't orphan it on the SFU.
        if (in_array((string) $rec->status, ['STARTING', 'RECORDING'], true) && $rec->egress_id !== null) {
            $this->egress->stopEgress((string) $rec->egress_id);
        }

        // Best-effort object removal — never block the row delete on a storage miss (the retention
        // purge is the backstop).
        if ($rec->storage_key !== null && $rec->storage_key !== '') {
            try {
                Storage::disk('video_recordings')->delete((string) $rec->storage_key);
            } catch (\Throwable) {
                // ignore — proceed with the row delete
            }
        }

        DB::table('room_recordings')->where('id', $id)->delete();
        Audit::log('video_recording.delete', 'room_recording', $id, (string) $this->ctx()->academyId, $this->ctx()->userId, $this->ctx()->role, before: ['room_id' => $rec->room_id, 'status' => $rec->status]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/video/rooms/{id}/recording — start an on-demand recording (logged-in manager). */
    public function start(string $id): JsonResponse
    {
        // A managing host OR a supervisor (room.monitor) may record — the latter can record while
        // hidden (08-ROOM-ACCESS §5). Recording remains opt-in per session (V-REC-1).
        $ctx = $this->ctx();
        if (! $ctx->can('room.manage') && ! $ctx->can('room.monitor')) {
            abort(403, 'You do not have permission to record this room.');
        }

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        return $this->doStart(
            (string) $ctx->academyId,
            $id,
            (string) $room->livekit_name,
            $this->parseConfig($room->config ?? null),
            $ctx->userId,
            (string) $ctx->role,
        );
    }

    /**
     * POST /api/video/manage/{manageToken}/recording — start a recording from the no-login HOST LINK
     * (08-ROOM-ACCESS §13.5). Possession of the host_token is the authority; the DB write runs in the
     * room's tenant context (no session sets one on this public route).
     */
    public function startByManage(string $manageToken): JsonResponse
    {
        $room = $this->requireHostRoomByToken($manageToken);
        $academyId = (string) $room['academy_id'];

        return Tenancy::withContext($this->systemContext($academyId), fn (): JsonResponse => $this->doStart(
            $academyId,
            (string) $room['room_id'],
            (string) $room['livekit_name'],
            $this->parseConfig($room['config'] ?? null),
            null,
            'HOST_LINK',
        ));
    }

    /** DELETE /api/video/rooms/{id}/recording — stop the room's active recording (logged-in manager). */
    public function stop(string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        return $this->doStop($id);
    }

    /** DELETE /api/video/manage/{manageToken}/recording — stop a recording from the host link. */
    public function stopByManage(string $manageToken): JsonResponse
    {
        $room = $this->requireHostRoomByToken($manageToken);
        $academyId = (string) $room['academy_id'];

        return Tenancy::withContext($this->systemContext($academyId), fn (): JsonResponse => $this->doStop((string) $room['room_id']));
    }

    /**
     * Start the egress + write the STARTING row. Shared by the logged-in manager and the host-link
     * paths; the caller has already established the tenant context the DB write needs.
     *
     * @param  array<string,mixed>  $config
     */
    private function doStart(string $academyId, string $roomId, string $livekitName, array $config, ?string $actorId, string $actorRole): JsonResponse
    {
        // Plan recording gate (FeatureCatalog `recordingAllowed`, fail open): a plan can exclude
        // recording entirely. Resolved by academy id so it holds on the no-login host-link path too.
        if (! Entitlement::flagFor($academyId, 'recordingAllowed')) {
            abort(response()->json(['code' => 'recording_not_in_plan', 'message' => "Recording isn't included in this academy's plan."], 403));
        }
        // Per-room recording gate (08-ROOM-ACCESS §4). Default true preserves today's behaviour for
        // rooms created before settings existed (empty config → allowed).
        if (($config['recording_enabled'] ?? true) === false) {
            abort(403, 'Recording is disabled for this room.');
        }

        $recordingId = (string) Str::uuid();
        $output = $this->fileOutput($recordingId);

        $res = $this->egress->startRoomComposite($livekitName, $output);
        if (! $res['ok']) {
            abort(502, 'Recording could not be started.');
        }

        // Retention: the plan's per-academy `recordingRetentionDays` wins; else the global default.
        $retentionDays = Entitlement::limitFor($academyId, 'recordingRetentionDays') ?? $this->retentionDays();

        DB::table('room_recordings')->insert([
            'id' => $recordingId,
            'academy_id' => $academyId,
            'room_id' => $roomId,
            'egress_id' => $res['egress_id'],
            'status' => 'STARTING',
            'storage_key' => $output['filepath'],
            'started_at' => now(),
            'expires_at' => now()->addDays($retentionDays),
        ]);
        Audit::log('video_recording.start', 'room_recording', $recordingId, $academyId, $actorId, $actorRole, after: ['room_id' => $roomId]);

        return response()->json(['recordingId' => $recordingId], 201);
    }

    /** Stop the room's active egress + mark the intent (final status comes from the egress webhook). */
    private function doStop(string $roomId): JsonResponse
    {
        $recording = DB::table('room_recordings')
            ->where('room_id', $roomId)
            ->whereIn('status', ['STARTING', 'RECORDING'])
            ->orderByDesc('created_at')
            ->first();
        if ($recording === null) {
            abort(404, 'No active recording for this room.');
        }

        if ($recording->egress_id !== null) {
            $this->egress->stopEgress((string) $recording->egress_id);
        }
        DB::table('room_recordings')->where('id', $recording->id)->update(['updated_at' => now()]);

        return response()->json(['ok' => true]);
    }

    /** Decode a room's settings JSONB (array already-decoded by the reader, or a raw string). */
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

    /** A system SUPER_ADMIN context for the academy — the tenant context the host-link writes run in. */
    private function systemContext(string $academyId): AuthContext
    {
        return new AuthContext(self::SYSTEM_USER_ID, $academyId, 'SUPER_ADMIN', []);
    }

    private function ctx(): AuthContext
    {
        return app(AuthContext::class);
    }

    private function retentionDays(): int
    {
        return (int) config('services.livekit.recording_retention_days', 90);
    }

    /** @return array{filepath: string, s3: array<string,mixed>} */
    private function fileOutput(string $recordingId): array
    {
        $output = ['filepath' => "recordings/{$recordingId}.mp4"];

        $key = (string) config('services.livekit.s3_key');
        $secret = (string) config('services.livekit.s3_secret');
        $endpoint = (string) config('services.livekit.s3_endpoint');

        // Only attach explicit S3 credentials when they are configured. With empty credentials the
        // Egress service rejects the request and recording 502s on start; omitting the upload block
        // instead lets Egress fall back to the storage in its own egress.yaml (the deployed default),
        // so recording keeps working even before the control plane's LIVEKIT_S3_* env is wired.
        if ($key !== '' && $secret !== '' && $endpoint !== '') {
            $output['s3'] = [
                'access_key' => $key,
                'secret' => $secret,
                'bucket' => (string) config('services.livekit.s3_bucket'),
                'endpoint' => $endpoint,
                'region' => (string) config('services.livekit.s3_region'),
                'force_path_style' => true,
            ];
        }

        return $output;
    }
}
