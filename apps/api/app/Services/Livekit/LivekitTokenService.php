<?php

declare(strict_types=1);

namespace App\Services\Livekit;

/**
 * Mints scoped LiveKit access tokens (JWTs). The control plane is the ONLY holder of the API
 * secret (V-SEC-1): a client receives a short-lived token whose `video` grant is derived from the
 * caller's RBAC capabilities — never an admin or recording grant. Also mints the short-lived
 * server-admin token the room/egress clients use to call the LiveKit server API.
 *
 * Pure (no network), so it is unit-testable without a running SFU. Grant key casing (camelCase
 * inside the `video` claim) matches LiveKit and is verified against a live server (Phase 0).
 */
final class LivekitTokenService
{
    /**
     * Sign a token for $identity with the given video grant + optional extra claims.
     *
     * @param  array<string,mixed>  $videoGrant
     * @param  array<string,mixed>  $claims
     */
    public function mint(string $identity, array $videoGrant, array $claims = [], ?int $ttl = null): string
    {
        $now = time();
        $ttl ??= (int) config('services.livekit.token_ttl', 900);

        $payload = array_merge([
            'iss' => (string) config('services.livekit.api_key'),
            'sub' => $identity,
            'nbf' => $now,
            'exp' => $now + $ttl,
            'video' => $videoGrant,
        ], $claims);

        return Jwt::encode($payload, (string) config('services.livekit.api_secret'));
    }

    /**
     * A participant who may join, publish and subscribe. `roomAdmin` (in-call moderation) is
     * granted ONLY when the caller holds room.manage. Recording is never client-granted.
     */
    public function accessToken(string $roomName, string $identity, ?string $displayName, bool $canManage): string
    {
        $grant = [
            'room' => $roomName,
            'roomJoin' => true,
            'canPublish' => true,
            'canSubscribe' => true,
            'canPublishData' => true,
        ];
        if ($canManage) {
            $grant['roomAdmin'] = true;
        }

        $claims = $displayName !== null && $displayName !== '' ? ['name' => $displayName] : [];

        return $this->mint($identity, $grant, $claims);
    }

    /** A guest (student via a signed link): join + publish + subscribe only — never admin/record. */
    public function guestToken(string $roomName, string $identity, ?string $displayName): string
    {
        return $this->accessToken($roomName, $identity, $displayName, canManage: false);
    }

    /** Short-lived server-admin token for room/egress lifecycle calls to the LiveKit server API. */
    public function adminToken(): string
    {
        return $this->mint('server-admin', [
            'roomCreate' => true,
            'roomList' => true,
            'roomAdmin' => true,
            'roomRecord' => true,
        ], ttl: 60);
    }

    /**
     * Short-lived admin token SCOPED to one room. Room-scoped RoomService ops (ListParticipants,
     * RemoveParticipant, MutePublishedTrack, …) require `roomAdmin` together with the `room` claim
     * — a roomAdmin token without a room is rejected as "permissions denied".
     */
    public function roomAdminToken(string $room): string
    {
        return $this->mint('server-admin', [
            'roomAdmin' => true,
            'room' => $room,
        ], ttl: 60);
    }
}
