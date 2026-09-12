<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Validation\Rule;

/**
 * The rules a client's handle must obey — the ONE place that says what `<handle>.<root>` may be
 * (docs/lms/02).
 *
 * A handle is not just a column: wildcard DNS turns every accepted value into a live hostname on
 * the platform's own domain, so an unvalidated one can shadow infrastructure. Three separate
 * consequences, which is why this is centralised rather than repeated per controller:
 *
 *  1. **Platform hosts.** `app`, `api`, `www` and friends are the platform's own addresses. The web
 *     middleware already refuses to treat them as academy handles (its RESERVED set), so an academy
 *     that managed to claim one would simply never resolve — a client with a dead address and no
 *     error anywhere explaining why.
 *  2. **Real DNS records.** `media` and `turn` are explicit DNS-only A records pointing at the media
 *     box (DEPLOYMENT.md §DNS). They win over the wildcard, so that handle can never reach the app.
 *  3. **Impersonation.** `login`, `secure`, `billing`, `account` and similar read as platform
 *     infrastructure to a visitor. A tenant-controlled page on such a host, wearing tenant-supplied
 *     branding, is a phishing surface the platform itself would be lending credibility to.
 *
 * The format rules are DNS-label rules (lowercase alphanumerics and inner hyphens), plus two the
 * label syntax does not cover: a minimum of three characters, matching the spec's `{3,40}` and
 * keeping the short, valuable handles from being taken by accident; and a refusal of the `xn--`
 * punycode prefix, which is how a handle would be made to *render* as something it is not.
 */
final class Subdomain
{
    /** Shortest accepted handle — the spec's `^[a-z0-9-]{3,40}$` floor (docs/lms/02 §1). */
    public const MIN = 3;

    /** A DNS label's own ceiling. */
    public const MAX = 63;

    /** A DNS label: lowercase alphanumerics, hyphens allowed only on the inside. */
    public const PATTERN = '/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/';

    /**
     * Handles the platform keeps for itself. Mirrors — and deliberately exceeds — the web
     * middleware's RESERVED set (`apps/web/src/middleware.ts`): that list only has to name the hosts
     * the router must not treat as a tenant, while this one also refuses the names that would be
     * dishonest or would collide with a real DNS record. Keep the two in sync when adding a host.
     *
     * @var list<string>
     */
    public const RESERVED = [
        // The platform's own hosts (must match the web middleware's RESERVED set).
        'www', 'app', 'api', 'admin', 'mail', 'static', 'assets', 'cdn',
        // Explicit DNS records that outrank the wildcard (DEPLOYMENT.md §DNS records).
        'media', 'turn', 'livekit', 'video',
        // Infrastructure names a future record may need.
        'ns', 'ns1', 'ns2', 'mx', 'smtp', 'imap', 'pop', 'webmail', 'email', 'ftp', 'vpn',
        'gateway', 'wa', 'whatsapp', 'db', 'redis', 'proxy', 'edge', 'origin',
        // Environments.
        'dev', 'test', 'stage', 'staging', 'preview', 'sandbox', 'local', 'localhost',
        // Names that read as the platform speaking, not a tenant (phishing surface).
        'login', 'signin', 'signup', 'register', 'auth', 'sso', 'account', 'accounts',
        'billing', 'pay', 'payment', 'payments', 'invoice', 'invoices', 'checkout',
        'secure', 'security', 'verify', 'support', 'help', 'status', 'system', 'root',
        'official', 'acadmyq', 'academiq', 'platform',
        // Application paths that would make a confusing second address for the same thing.
        'learn', 'site', 'sites', 'portal', 'dashboard', 'docs', 'blog', 'news', 'about',
        'public', 'internal', 'files', 'download', 'downloads', 'img', 'images',
    ];

    /**
     * Validation rules for a handle column.
     *
     * @param  string|null  $ignoreId  the academy row this value belongs to, so an unchanged handle
     *                                 does not collide with itself on update.
     * @return list<mixed>
     */
    public static function rules(?string $ignoreId = null): array
    {
        return [
            'nullable', 'string',
            'min:'.self::MIN,
            'max:'.self::MAX,
            'regex:'.self::PATTERN,
            // Punycode: `xn--` is how a handle is made to display as characters it does not contain.
            'not_regex:/^xn--/i',
            Rule::notIn(self::RESERVED),
            Rule::unique('academies', 'subdomain')->ignore($ignoreId),
        ];
    }

    /** Is this handle one the platform keeps for itself? */
    public static function isReserved(string $handle): bool
    {
        return in_array(strtolower(trim($handle)), self::RESERVED, true);
    }

    /** Trim + lowercase a submitted handle; blank (or null) becomes null — "no site published". */
    public static function normalize(mixed $value): ?string
    {
        $handle = strtolower(trim((string) $value));

        return $handle === '' ? null : $handle;
    }
}
