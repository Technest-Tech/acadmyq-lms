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
            $res = $this->http()->post('/twirp/livekit.RoomService/ListParticipants', ['room' => $room]);
            if (! $res->successful()) {
                return ['ok' => false, 'participants' => []];
            }

            return ['ok' => true, 'participants' => (array) ($res->json('participants') ?? [])];
        } catch (Throwable) {
            return ['ok' => false, 'participants' => []];
        }
    }

    private function http(): PendingRequest
    {
        return Http::withToken($this->tokens->adminToken())
            ->acceptJson()
            ->asJson()
            ->baseUrl((string) config('services.livekit.api_url'))
            ->timeout((int) config('services.livekit.timeout', 15));
    }
}
