<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Services\Livekit\LivekitEgressClient;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Recordings — on-demand only (V-REC-1). Start/stop are owner/manager actions (room.manage);
 * listing/replay requires recording.view. Starting kicks off a LiveKit Egress and writes a
 * STARTING row; the egress webhook later finalises it (LivekitWebhookController). Retention is
 * stamped at creation (V-REC-2) and enforced by PurgeExpiredRecordingsJob. The full S3 output
 * wiring + signed-URL replay land with Phase 4 — Phase 1 establishes the seam.
 */
final class VideoRecordingController extends Controller
{
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

    /** POST /api/video/rooms/{id}/recording — start an on-demand recording. */
    public function start(string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        $ctx = $this->ctx();
        $recordingId = (string) Str::uuid();
        $output = $this->fileOutput($recordingId);

        $res = $this->egress->startRoomComposite((string) $room->livekit_name, $output);
        if (! $res['ok']) {
            abort(502, 'Recording could not be started.');
        }

        DB::table('room_recordings')->insert([
            'id' => $recordingId,
            'academy_id' => (string) $ctx->academyId,
            'room_id' => $id,
            'egress_id' => $res['egress_id'],
            'status' => 'STARTING',
            'storage_key' => $output['filepath'],
            'started_at' => now(),
            'expires_at' => now()->addDays($this->retentionDays()),
        ]);
        Audit::log('video_recording.start', 'room_recording', $recordingId, (string) $ctx->academyId, $ctx->userId, $ctx->role, after: ['room_id' => $id]);

        return response()->json(['recordingId' => $recordingId], 201);
    }

    /** DELETE /api/video/rooms/{id}/recording — stop the room's active recording. */
    public function stop(string $id): JsonResponse
    {
        Gate::authorize('room.manage');

        $recording = DB::table('room_recordings')
            ->where('room_id', $id)
            ->whereIn('status', ['STARTING', 'RECORDING'])
            ->orderByDesc('created_at')
            ->first();
        if ($recording === null) {
            abort(404, 'No active recording for this room.');
        }

        if ($recording->egress_id !== null) {
            $this->egress->stopEgress((string) $recording->egress_id);
        }
        // Final status is set by the egress_ended webhook; mark the intent here.
        DB::table('room_recordings')->where('id', $recording->id)->update(['updated_at' => now()]);

        return response()->json(['ok' => true]);
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
        return [
            'filepath' => "recordings/{$recordingId}.mp4",
            's3' => [
                'access_key' => (string) config('services.livekit.s3_key'),
                'secret' => (string) config('services.livekit.s3_secret'),
                'bucket' => (string) config('services.livekit.s3_bucket'),
                'endpoint' => (string) config('services.livekit.s3_endpoint'),
                'force_path_style' => true,
            ],
        ];
    }
}
