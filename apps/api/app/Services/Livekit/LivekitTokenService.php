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
     * granted ONLY when the caller holds room.manage. Recording is never client-granted. Carries a
     * `metadata.role=host` marker so server-side checks (require_host_present) and the participant
     * UI can tell a host from a guest (08-ROOM-ACCESS §6.3).
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

        return $this->mint($identity, $grant, $this->participantClaims($displayName, 'host'));
    }

    /**
     * A guest (student via a shareable link): join + publish + subscribe only — never admin/record.
     * When the room disables guest screen-share (`allow_guest_screenshare=false`), the grant is
     * narrowed to camera + microphone sources so a guest token cannot publish a screen share
     * (08-ROOM-ACCESS §4). Carries a `metadata.role=guest` marker.
     */
    public function guestToken(string $roomName, string $identity, ?string $displayName, bool $allowScreenshare = true): string
    {
        $grant = [
            'room' => $roomName,
            'roomJoin' => true,
            'canPublish' => true,
            'canSubscribe' => true,
            'canPublishData' => true,
        ];
        if (! $allowScreenshare) {
            // LiveKit TrackSource names (lowercase): omitting screen_share blocks screen publishing
            // at the SFU regardless of what the client attempts.
            $grant['canPublishSources'] = ['camera', 'microphone'];
        }

        return $this->mint($identity, $grant, $this->participantClaims($displayName, 'guest'));
    }

    /**
     * Top-level JWT claims shared by participant tokens: an optional display `name` and a
     * `metadata` JSON string carrying the participant's room role.
     *
     * @return array<string,mixed>
     */
    private function participantClaims(?string $displayName, string $role): array
    {
        $claims = ['metadata' => json_encode(['role' => $role])];
        if ($displayName !== null && $displayName !== '') {
            $claims['name'] = $displayName;
        }

        return $claims;
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
