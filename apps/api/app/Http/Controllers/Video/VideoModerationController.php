<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Services\Livekit\LivekitRoomClient;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * In-call host moderation (docs/video-platform — V-CTL-1). All actions require room.manage and are
 * server-mediated: the browser never holds the LiveKit admin secret (V-SEC-1), it asks the control
 * plane, which acts on the SFU with a freshly-minted admin token. The room is resolved under the
 * caller's tenant context (RLS), so a host can only moderate their own academy's room.
 */
final class VideoModerationController extends Controller
{
    public function __construct(private readonly LivekitRoomClient $rooms) {}

    /** POST /video/rooms/{id}/participants/{identity}/mute — force-mute a participant's mic. */
    public function mute(string $id, string $identity): JsonResponse
    {
        $room = $this->authorizeRoom($id);

        $sid = $this->rooms->micTrackSid($room->livekit_name, $identity);
        // No live mic track → nothing to mute; treat as a no-op success so the UI stays simple.
        if ($sid !== null && ! $this->rooms->mutePublishedTrack($room->livekit_name, $identity, $sid, true)) {
            abort(502, 'Could not mute the participant.');
        }

        $this->audit('video.participant_muted', $id, $identity);

        return response()->json(['ok' => true]);
    }

    /** POST /video/rooms/{id}/participants/{identity}/remove — kick a participant from the call. */
    public function remove(string $id, string $identity): JsonResponse
    {
        $room = $this->authorizeRoom($id);

        if (! $this->rooms->removeParticipant($room->livekit_name, $identity)) {
            abort(502, 'Could not remove the participant.');
        }

        $this->audit('video.participant_removed', $id, $identity);

        return response()->json(['ok' => true]);
    }

    /** POST /video/rooms/{id}/end — end the live call for everyone (DB room stays ACTIVE). */
    public function end(string $id): JsonResponse
    {
        $room = $this->authorizeRoom($id);

        if (! $this->rooms->deleteRoom($room->livekit_name)) {
            abort(502, 'Could not end the call.');
        }

        $this->audit('video.call_ended', $id, null);

        return response()->json(['ok' => true]);
    }

    /** Resolve the room under RLS (so cross-tenant 404s) after gating on room.manage. */
    private function authorizeRoom(string $id): object
    {
        Gate::authorize('room.manage');

        $room = DB::table('video_rooms')->where('id', $id)->whereNull('deleted_at')->first();
        if ($room === null) {
            abort(404, 'Room not found.');
        }

        return $room;
    }

    private function audit(string $action, string $roomId, ?string $identity): void
    {
        $ctx = app(AuthContext::class);
        Audit::log($action, 'video_room', $roomId, (string) $ctx->academyId, $ctx->userId, $ctx->role, after: array_filter([
            'room_id' => $roomId,
            'identity' => $identity,
        ]));
    }
}
