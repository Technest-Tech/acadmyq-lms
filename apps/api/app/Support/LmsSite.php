<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The one place that turns an academy's `subdomain` handle into the URL of its public course site
 * (docs/lms/02). Both the client's own LMS dashboard and the Super Admin oversight page render this
 * link, and they must never disagree about it — hence a single helper rather than the string
 * concatenation each was doing.
 *
 * Two shapes, decided by whether a root domain is configured:
 *
 *  - CONFIGURED (`LMS_SITE_ROOT_DOMAIN`) ⇒ the real site origin, `{scheme}://{sub}.{root}`. The root
 *    may include a port for local development (`localhost:3000`); the web middleware matches on
 *    hostname alone, so the port only ever affects the link.
 *  - UNSET ⇒ the in-app path `/learn/{sub}`, which serves the same site. Subdomain routing is off
 *    until DNS is configured, so a link to `<sub>.<root>` would simply not resolve — the path always
 *    works, which is what makes the dashboard's "visit your site" link safe in every environment.
 *
 * Callers should surface `configured()` too: a path-shaped URL means "subdomain routing is not set
 * up", and presenting it as though it were a live subdomain is what makes the feature look broken.
 */
final class LmsSite
{
    /** The configured root domain (possibly with a port), or '' when subdomain routing is off. */
    public static function rootDomain(): string
    {
        return trim((string) config('lms.site.root_domain', ''));
    }

    /** Is subdomain routing configured? False ⇒ URLs are in-app paths, not real origins. */
    public static function configured(): bool
    {
        return self::rootDomain() !== '';
    }

    /** `http` locally, `https` in production. */
    public static function scheme(): string
    {
        $scheme = strtolower(trim((string) config('lms.site.scheme', 'https')));

        return $scheme === 'http' ? 'http' : 'https';
    }

    /**
     * The site URL for a handle — a real origin when a root domain is configured, else the in-app
     * path. Null when the academy has no handle (site not published).
     */
    public static function url(?string $subdomain): ?string
    {
        if ($subdomain === null || $subdomain === '') {
            return null;
        }

        return self::configured()
            ? self::scheme().'://'.$subdomain.'.'.self::rootDomain()
            : '/learn/'.$subdomain;
    }

    /**
     * The site block both LMS surfaces embed, so the client dashboard and the admin page expose an
     * identical contract.
     *
     * @return array{subdomain: ?string, url: ?string, root_domain: ?string, configured: bool}
     */
    public static function block(?string $subdomain): array
    {
        return [
            'subdomain' => $subdomain,
            'url' => self::url($subdomain),
            'root_domain' => self::configured() ? self::rootDomain() : null,
            'configured' => self::configured(),
        ];
    }
}
