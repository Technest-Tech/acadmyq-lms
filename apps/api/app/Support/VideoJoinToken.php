<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Builds the unguessable `join_token` that powers a room's shareable link
 * (`/r/{join_token}`, docs/video-platform/06-WEB-CALL-CLIENT §2).
 *
 * Anyone holding the link can reach the pre-join lobby (the Zoom-style model), so the token IS
 * the secret — it must clear the same 128-bit entropy floor the public-invoice token does. At
 * 24 chars of [A-Za-z0-9], 24 × log2(62) ≈ 143 bits, comfortably above the floor. No separators:
 * the token stays strictly [A-Za-z0-9]+ so it matches the public-route regex.
 */
final class VideoJoinToken
{
    /** 24 × log2(62) ≈ 143 bits, well over the 128-bit floor. */
    private const LEN = 24;

    /** Host/monitor links are shared secrets that grant elevated roles — give them more headroom. */
    private const SECRET_LEN = 40;

    public static function generate(): string
    {
        return Str::random(self::LEN);
    }

    /**
     * A higher-entropy secret for the private host/monitor links (08-ROOM-ACCESS §2). 40 × log2(62)
     * ≈ 238 bits, and strictly [A-Za-z0-9] so it still matches the public join route's token regex.
     */
    public static function generateSecret(): string
    {
        return Str::random(self::SECRET_LEN);
    }
}
