<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Video\Concerns\ResolvesRoomByToken;
use App\Services\Livekit\LivekitRoomClient;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * In-call host moderation (docs/video-platform — V-CTL-1). Server-mediated: the browser never holds
 * the LiveKit admin secret (V-SEC-1), it asks the control plane, which acts on the SFU with a
 * freshly-minted admin token. Two authorities reach the same actions:
 *   - a logged-in manager (room.manage), resolved under their tenant context (RLS); or
 *   - the no-login HOST LINK (the room's host_token), so an unregistered teacher moderates from the
 *     link alone (08-ROOM-ACCESS §13.5) — possession of the secret IS the authority.
 */
final class VideoModerationController extends Controller
{
    use ResolvesRoomByToken;

    public function __construct(private readonly LivekitRoomClient $rooms) {}

    /** POST /video/manage/{manageToken}/participants/{identity}/mute — host-link force-mute. */
    public function muteByManage(string $manageToken, string $identity): JsonResponse
    {
        $room = $this->requireHostRoomByToken($manageToken);

        $this->doMute((string) $room['livekit_name'], $identity);
        $this->auditByLink('video.participant_muted', (string) $room['academy_id'], (string) $room['room_id'], $identity);

        return response()->json(['ok' => true]);
    }

    /** POST /video/manage/{manageToken}/participants/{identity}/remove — host-link kick. */
    public function removeByManage(string $manageToken, string $identity): JsonResponse
    {
        $room = $this->requireHostRoomByToken($manageToken);

        if (! $this->rooms->removeParticipant((string) $room['livekit_name'], $identity)) {
            abort(502, 'Could not remove the participant.');
        }
        $this->auditByLink('video.participant_removed', (string) $room['academy_id'], (string) $room['room_id'], $identity);

        return response()->json(['ok' => true]);
    }

    /** POST /video/manage/{manageToken}/participants/{identity}/mute-video — host-link force camera off. */
    public function muteVideoByManage(string $manageToken, string $identity): JsonResponse
    {
        $room = $this->requireHostRoomByToken($manageToken);

        $this->doMuteVideo((string) $room['livekit_name'], $identity);
        $this->auditByLink('video.participant_video_muted', (string) $room['academy_id'], (string) $room['room_id'], $identity);

        return response()->json(['ok' => true]);
    }

    /** POST /video/manage/{manageToken}/end — host-link end-for-all. */
    public function endByManage(string $manageToken): JsonResponse
    {
        $room = $this->requireHostRoomByToken($manageToken);

        if (! $this->rooms->deleteRoom((string) $room['livekit_name'])) {
            abort(502, 'Could not end the call.');
        }
        $this->auditByLink('video.call_ended', (string) $room['academy_id'], (string) $room['room_id'], null);

        return response()->json(['ok' => true]);
    }

    /** POST /video/rooms/{id}/participants/{identity}/mute — force-mute a participant's mic. */
    public function mute(string $id, string $identity): JsonResponse
    {
        $room = $this->authorizeRoom($id);

        $this->doMute((string) $room->livekit_name, $identity);
        $this->audit('video.participant_muted', $id, $identity);

        return response()->json(['ok' => true]);
    }

    /** Force-mute a participant's mic track on the SFU. A no-op success when they have no live mic. */
    private function doMute(string $livekitName, string $identity): void
    {
        $sid = $this->rooms->micTrackSid($livekitName, $identity);
        // No live mic track → nothing to mute; treat as a no-op success so the UI stays simple.
        if ($sid !== null && ! $this->rooms->mutePublishedTrack($livekitName, $identity, $sid, true)) {
            abort(502, 'Could not mute the participant.');
        }
    }

    /** POST /video/rooms/{id}/participants/{identity}/mute-video — force a participant's camera off. */
    public function muteVideo(string $id, string $identity): JsonResponse
    {
        $room = $this->authorizeRoom($id);

        $this->doMuteVideo((string) $room->livekit_name, $identity);
        $this->audit('video.participant_video_muted', $id, $identity);

        return response()->json(['ok' => true]);
    }

    /** Force-mute a participant's camera track on the SFU. A no-op success when they have no live camera. */
    private function doMuteVideo(string $livekitName, string $identity): void
    {
        $sid = $this->rooms->cameraTrackSid($livekitName, $identity);
        // No live camera track → nothing to stop; treat as a no-op success so the UI stays simple.
        if ($sid !== null && ! $this->rooms->mutePublishedTrack($livekitName, $identity, $sid, true)) {
            abort(502, "Could not stop the participant's video.");
        }
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

    /** Audit a host-LINK moderation action (no session): actor is the link, not a user. */
    private function auditByLink(string $action, string $academyId, string $roomId, ?string $identity): void
    {
        Audit::log($action, 'video_room', $roomId, $academyId, null, 'HOST_LINK', after: array_filter([
            'room_id' => $roomId,
            'identity' => $identity,
        ]));
    }
}
