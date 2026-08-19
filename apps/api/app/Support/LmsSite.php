<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The one place that turns an academy's `subdomain` handle into the URL of its public course site
 * (docs/lms/02). Both the client's own LMS dashboard and the Super Admin oversight page render this
 * link, and they must never disagree about it — hence a single helper rather than the string
 * concatenation each was doing.
 *
 * Two shapes, decided by whether a root domain is configured (and, on a real origin, by whether the
 * course site owns the root of that host — see `ownsRoot`):
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
    /**
     * The CANONICAL root domain (possibly with a port), or '' when subdomain routing is off.
     *
     * The setting may list several roots, comma-separated, mirroring the web app's
     * NEXT_PUBLIC_ROOT_DOMAIN: the middleware MATCHES every one of them (a client host can be
     * reachable at more than one address in development), while a link handed to a client has to
     * name exactly one — the first.
     */
    public static function rootDomain(): string
    {
        $roots = array_filter(array_map('trim', explode(',', (string) config('lms.site.root_domain', ''))));

        return (string) (reset($roots) ?: '');
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
     * Does the course site own the ROOT of this client's host?
     *
     * A client's `<handle>.<root>` serves one of two products, and only one of them can answer at
     * `/`: for a client whose whole product IS the course platform (`lms.only`) that is the course
     * site, and for everyone else it is their management sign-in — their course site, if they have
     * one, sits one path down. The web middleware splits the host on exactly this fact, so the URL
     * this class hands out has to be decided by the same predicate or the two would disagree.
     */
    public static function ownsRoot(string $academyId): bool
    {
        return in_array('lms.only', Entitlement::resolve($academyId)['capabilities'], true);
    }

    /**
     * The site URL for a handle — a real origin when a root domain is configured, else the in-app
     * path. Null when the academy has no handle (site not published).
     *
     * `$ownsRoot` false (a client running the management panel on that host) puts the course site at
     * `/learn/{sub}` under their own origin, because `/` there is their sign-in. Unconfigured roots
     * are unaffected: the in-app path is the same either way.
     */
    public static function url(?string $subdomain, bool $ownsRoot = true): ?string
    {
        if ($subdomain === null || $subdomain === '') {
            return null;
        }

        if (! self::configured()) {
            return '/learn/'.$subdomain;
        }

        $origin = self::scheme().'://'.$subdomain.'.'.self::rootDomain();

        return $ownsRoot ? $origin : $origin.'/learn/'.$subdomain;
    }

    /**
     * The site block both LMS surfaces embed, so the client dashboard and the admin page expose an
     * identical contract.
     *
     * @return array{subdomain: ?string, url: ?string, root_domain: ?string, configured: bool}
     */
    public static function block(?string $subdomain, bool $ownsRoot = true): array
    {
        return [
            'subdomain' => $subdomain,
            'url' => self::url($subdomain, $ownsRoot),
            'root_domain' => self::configured() ? self::rootDomain() : null,
            'configured' => self::configured(),
        ];
    }
}
