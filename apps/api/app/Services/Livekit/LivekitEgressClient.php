<?php

declare(strict_types=1);

namespace App\Services\Livekit;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Recording (Egress) lifecycle on the LiveKit server API. On-demand only (V-REC-1): start a
 * room-composite recording that uploads to the configured S3-compatible bucket, stop by egress
 * id. Structured ['ok' => ...] returns like the other LiveKit clients. The full output/storage
 * wiring and retention purge land with Phase 4; Phase 1 establishes the seam + the egress id we
 * reconcile against in the webhook.
 */
final class LivekitEgressClient
{
    public function __construct(private readonly LivekitTokenService $tokens) {}

    /**
     * Start a room-composite recording. $output is a LiveKit EncodedFileOutput (S3) descriptor.
     *
     * @param  array<string,mixed>  $output
     * @return array{ok: bool, egress_id: ?string, error: ?string}
     */
    public function startRoomComposite(string $room, array $output): array
    {
        try {
            $res = $this->http()->post('/twirp/livekit.Egress/StartRoomCompositeEgress', [
                'room_name' => $room,
                'file_outputs' => [$output],
            ]);
            if (! $res->successful()) {
                return ['ok' => false, 'egress_id' => null, 'error' => "http_{$res->status()}"];
            }

            return ['ok' => true, 'egress_id' => (string) ($res->json('egress_id') ?? ''), 'error' => null];
        } catch (Throwable) {
            return ['ok' => false, 'egress_id' => null, 'error' => 'transport_error'];
        }
    }

    /**
     * Reachability probe for the Super Admin health card: a cheap ListEgress read scoped to active
     * jobs. Returns whether the Egress service answered, plus the count of in-flight egresses (a
     * second source for the concurrent-recording capacity hint).
     *
     * @return array{ok: bool, active: int, error: ?string}
     */
    public function ping(): array
    {
        try {
            $res = $this->http()->post('/twirp/livekit.Egress/ListEgress', ['active' => true]);
            if (! $res->successful()) {
                return ['ok' => false, 'active' => 0, 'error' => "http_{$res->status()}"];
            }

            return ['ok' => true, 'active' => count((array) ($res->json('items') ?? [])), 'error' => null];
        } catch (Throwable) {
            return ['ok' => false, 'active' => 0, 'error' => 'transport_error'];
        }
    }

    /** @return array{ok: bool} */
    public function stopEgress(string $egressId): array
    {
        try {
            return ['ok' => $this->http()->post('/twirp/livekit.Egress/StopEgress', ['egress_id' => $egressId])->successful()];
        } catch (Throwable) {
            return ['ok' => false];
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
