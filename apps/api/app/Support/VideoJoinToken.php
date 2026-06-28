<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Builds the tokens that power a room's shareable links (`/r/{token}`,
 * docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §14).
 *
 * The room links (guest/host/monitor) are now **auto-generated SHORT links** of the form
 * `{kebab-room-name}-{code}` (e.g. `halaqa-live-k3p9x`) — see `forRoom()`. The room name makes the
 * link human-readable; the ≤7-char lowercase-alnum random `code` makes it unguessable enough for a
 * shareable bearer link (the optional host password is the extra guard for the no-login host link).
 *
 * The legacy `generate()`/`generateSecret()` (strictly [A-Za-z0-9]) remain for the bearer
 * `knock_token` (the waiting-room poll secret, NOT a `/r/` link) and any back-compat callers.
 */
final class VideoJoinToken
{
    /** 24 × log2(62) ≈ 143 bits, well over the 128-bit floor. */
    private const LEN = 24;

    /** A higher-entropy bearer secret (e.g. the waiting-room knock_token). 40 × log2(62) ≈ 238 bits. */
    private const SECRET_LEN = 40;

    /** The random suffix on a short link — the brief's hard cap (≤ 7 lowercase alphanumerics). */
    private const CODE_LEN = 7;

    /** Cap the readable name prefix so even a long room name yields a tidy link. */
    private const SLUG_MAX = 32;

    /** Lowercase letters + digits only (no separators) — the short-link random suffix alphabet. */
    private const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

    public static function generate(): string
    {
        return Str::random(self::LEN);
    }

    /**
     * A higher-entropy bearer secret. 40 × log2(62) ≈ 238 bits, strictly [A-Za-z0-9]. Used for the
     * waiting-room `knock_token` (a poll secret, never surfaced as a `/r/` link).
     */
    public static function generateSecret(): string
    {
        return Str::random(self::SECRET_LEN);
    }

    /**
     * An auto-generated SHORT, human-readable room link: `{kebab-room-name}-{code}` where `code` is
     * ≤7 lowercase alphanumerics (08-ROOM-ACCESS §14). The name is kebab-cased + truncated; a name
     * with no ASCII letters/digits (e.g. Arabic-only) falls back to `room-{code}`. The result stays
     * within `[a-z0-9][a-z0-9-]*`, matching the public join route + the Next `/r/[token]` segment.
     */
    public static function forRoom(string $name): string
    {
        $slug = trim(Str::slug($name), '-');
        if ($slug === '') {
            $slug = 'room';
        }
        $slug = trim(Str::limit($slug, self::SLUG_MAX, ''), '-');

        return $slug.'-'.self::code();
    }

    /** A ≤7-char lowercase-alphanumeric random code (the unguessable suffix on a short link). */
    public static function code(): string
    {
        $max = strlen(self::CODE_ALPHABET) - 1;
        $out = '';
        for ($i = 0; $i < self::CODE_LEN; $i++) {
            $out .= self::CODE_ALPHABET[random_int(0, $max)];
        }

        return $out;
    }
}
