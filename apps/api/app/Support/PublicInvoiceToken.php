<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Builds the public_token that powers the no-auth invoice page (R-INV-5).
 *
 * Format: a short, human-recognisable academy slug prefix followed by random
 * fill, always TOTAL_LEN chars total, e.g. "alphaamW7MxGCWnrJVkjo2". The token
 * is fixed at 22 chars — the shortest length that still clears the 128-bit
 * entropy floor enforced by the public-invoice pen test (TC-9.18), since
 * 22 × log2(62) ≈ 131 bits. Going shorter would drop a public, unauthenticated
 * payment link below that floor.
 *
 * The random fill expands to backfill whatever the slug doesn't use (down to
 * an empty slug — e.g. a fully non-Latin academy name), so the total length,
 * and therefore the entropy guarantee, never depends on the academy name.
 *
 * No separators are used: the token must stay strictly [A-Za-z0-9]+ so it
 * matches the public-route regex and the entropy assertion.
 */
final class PublicInvoiceToken
{
    /** Fixed total length: 22 × log2(62) ≈ 131 bits, just over the 128-bit floor. */
    private const TOTAL_LEN = 22;

    /** Readable academy prefix budget; the rest (≥16 chars) is always random. */
    private const SLUG_LEN = 6;

    /** Build a token, fetching the academy name by id. */
    public static function forAcademyId(?string $academyId): string
    {
        $name = $academyId === null
            ? null
            : DB::table('academies')->where('id', $academyId)->value('name');

        return self::forName(is_string($name) ? $name : null);
    }

    /** Build a token from an already-known academy name. */
    public static function forName(?string $academyName): string
    {
        $slug = (string) Str::of((string) $academyName)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', '')
            ->limit(self::SLUG_LEN, '');

        return $slug.Str::random(self::TOTAL_LEN - strlen($slug));
    }
}
