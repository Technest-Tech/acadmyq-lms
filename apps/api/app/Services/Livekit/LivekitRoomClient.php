<?php

declare(strict_types=1);

namespace App\Services\Livekit;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Room lifecycle on the self-hosted LiveKit server API (Twirp). Mirrors GatewayAdminClient: a
 * stateless `final` class, authenticated by a freshly-minted server-admin token, every method
 * wrapped in try/catch and returned as a structured ['ok' => ...] shape so a provider hiccup
 * surfaces as a handled result rather than crashing the request. LiveKit auto-creates a room on
 * first join, so explicit createRoom is optional — delete (kick everyone) and list are the
 * common lifecycle calls.
 */
final class LivekitRoomClient
{
    public function __construct(private readonly LivekitTokenService $tokens) {}

    /** @return array{ok: bool, sid: ?string, error: ?string} */
    public function createRoom(string $name, array $opts = []): array
    {
        try {
            $res = $this->http()->post('/twirp/livekit.RoomService/CreateRoom', array_merge(['name' => $name], $opts));
            if (! $res->successful()) {
                return ['ok' => false, 'sid' => null, 'error' => "http_{$res->status()}"];
            }

            return ['ok' => true, 'sid' => (string) ($res->json('sid') ?? ''), 'error' => null];
        } catch (Throwable) {
            return ['ok' => false, 'sid' => null, 'error' => 'transport_error'];
        }
    }

    /**
     * Lightweight reachability probe for the Super Admin health card: a cheap read-only ListRooms
     * call against the SFU. Returns the live room count when reachable, a structured error otherwise.
     *
     * @return array{ok: bool, rooms: int, error: ?string}
     */
    public function ping(): array
    {
        try {
            $res = $this->http()->post('/twirp/livekit.RoomService/ListRooms', []);
            if (! $res->successful()) {
                return ['ok' => false, 'rooms' => 0, 'error' => "http_{$res->status()}"];
            }

            return ['ok' => true, 'rooms' => count((array) ($res->json('rooms') ?? [])), 'error' => null];
        } catch (Throwable) {
            return ['ok' => false, 'rooms' => 0, 'error' => 'transport_error'];
        }
    }

    /** Best-effort delete of a room on the SFU (kicks participants). */
    public function deleteRoom(string $name): bool
    {
        try {
            return $this->http()->post('/twirp/livekit.RoomService/DeleteRoom', ['room' => $name])->successful();
        } catch (Throwable) {
            return false;
        }
    }

    /** @return array{ok: bool, participants: array<int,mixed>} */
    public function listParticipants(string $room): array
    {
        try {
            $res = $this->httpForRoom($room)->post('/twirp/livekit.RoomService/ListParticipants', ['room' => $room]);
            if (! $res->successful()) {
                return ['ok' => false, 'participants' => []];
            }

            return ['ok' => true, 'participants' => (array) ($res->json('participants') ?? [])];
        } catch (Throwable) {
            return ['ok' => false, 'participants' => []];
        }
    }

    /** Remove (kick) a participant from a room — moderation, host-only (room.manage). */
    public function removeParticipant(string $room, string $identity): bool
    {
        try {
            return $this->httpForRoom($room)
                ->post('/twirp/livekit.RoomService/RemoveParticipant', ['room' => $room, 'identity' => $identity])
                ->successful();
        } catch (Throwable) {
            return false;
        }
    }

    /** Force-mute (or unmute) a participant's published track by sid — moderation, host-only. */
    public function mutePublishedTrack(string $room, string $identity, string $trackSid, bool $muted): bool
    {
        try {
            return $this->httpForRoom($room)
                ->post('/twirp/livekit.RoomService/MutePublishedTrack', [
                    'room' => $room,
                    'identity' => $identity,
                    'track_sid' => $trackSid,
                    'muted' => $muted,
                ])
                ->successful();
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * The sid of a participant's currently-published microphone (audio) track, or null. Used by the
     * mute-others moderation action so the browser only needs to pass the target identity.
     */
    public function micTrackSid(string $room, string $identity): ?string
    {
        $list = $this->listParticipants($room);
        if (! $list['ok']) {
            return null;
        }

        foreach ($list['participants'] as $p) {
            $p = (array) $p;
            if ((string) ($p['identity'] ?? '') !== $identity) {
                continue;
            }
            foreach ((array) ($p['tracks'] ?? []) as $track) {
                $track = (array) $track;
                // Real payload is camelCase JSON; accept the snake_case fallback too. Microphone
                // is TrackType AUDIO / TrackSource MICROPHONE.
                $type = (string) ($track['type'] ?? '');
                $source = (string) ($track['source'] ?? '');
                if ($type === 'AUDIO' || str_contains($source, 'MICROPHONE')) {
                    $sid = (string) ($track['sid'] ?? '');

                    return $sid !== '' ? $sid : null;
                }
            }
        }

        return null;
    }

    /**
     * The sid of a participant's currently-published CAMERA (video) track, or null. Powers the host
     * "stop video" moderation — the SCREEN_SHARE video track is deliberately excluded.
     */
    public function cameraTrackSid(string $room, string $identity): ?string
    {
        $list = $this->listParticipants($room);
        if (! $list['ok']) {
            return null;
        }

        foreach ($list['participants'] as $p) {
            $p = (array) $p;
            if ((string) ($p['identity'] ?? '') !== $identity) {
                continue;
            }
            foreach ((array) ($p['tracks'] ?? []) as $track) {
                $track = (array) $track;
                $type = (string) ($track['type'] ?? '');
                $source = (string) ($track['source'] ?? '');
                // Camera is TrackType VIDEO / TrackSource CAMERA — never the SCREEN_SHARE video track.
                if (str_contains($source, 'CAMERA') || ($type === 'VIDEO' && ! str_contains($source, 'SCREEN'))) {
                    $sid = (string) ($track['sid'] ?? '');

                    return $sid !== '' ? $sid : null;
                }
            }
        }

        return null;
    }

    private function http(): PendingRequest
    {
        return $this->client($this->tokens->adminToken());
    }

    /** Room-scoped admin client — required for ListParticipants/RemoveParticipant/MutePublishedTrack. */
    private function httpForRoom(string $room): PendingRequest
    {
        return $this->client($this->tokens->roomAdminToken($room));
    }

    private function client(string $token): PendingRequest
    {
        return Http::withToken($token)
            ->acceptJson()
            ->asJson()
            ->baseUrl((string) config('services.livekit.api_url'))
            ->timeout((int) config('services.livekit.timeout', 15));
    }
}
