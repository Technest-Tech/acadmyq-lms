<?php

declare(strict_types=1);

namespace App\Services\Livekit;

/**
 * Minimal HS256 JWT encode/decode for LiveKit. LiveKit access tokens are standard JWTs signed
 * with the API secret; LiveKit webhooks carry a JWT (signed with the same secret) whose `sha256`
 * claim is the base64 SHA-256 of the request body. We hand-roll HS256 rather than add a JWT
 * dependency — the structure is verified against a live LiveKit server (the Phase-0 smoke test in
 * docs/video-platform/02-INFRASTRUCTURE.md). The secret never leaves the server (V-SEC-1).
 */
final class Jwt
{
    /** @param  array<string,mixed>  $payload */
    public static function encode(array $payload, string $secret): string
    {
        $header = self::b64((string) json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_UNESCAPED_SLASHES));
        $body = self::b64((string) json_encode($payload, JSON_UNESCAPED_SLASHES));
        $signingInput = $header.'.'.$body;
        $sig = self::b64(hash_hmac('sha256', $signingInput, $secret, true));

        return $signingInput.'.'.$sig;
    }

    /**
     * Verify the signature + exp/nbf and return the claims, or null if anything is off (bad
     * shape, bad signature, expired, not-yet-valid). Constant-time signature comparison.
     *
     * @return array<string,mixed>|null
     */
    public static function decode(string $jwt, string $secret): ?array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            return null;
        }
        [$h, $b, $s] = $parts;

        $expected = self::b64(hash_hmac('sha256', $h.'.'.$b, $secret, true));
        if (! hash_equals($expected, $s)) {
            return null;
        }

        $claims = json_decode(self::unb64($b), true);
        if (! is_array($claims)) {
            return null;
        }

        $now = time();
        if (isset($claims['exp']) && $now >= (int) $claims['exp']) {
            return null;
        }
        if (isset($claims['nbf']) && $now < (int) $claims['nbf'] - 5) {
            return null;
        }

        return $claims;
    }

    private static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function unb64(string $b64): string
    {
        return (string) base64_decode(strtr($b64, '-_', '+/'), true);
    }
}
