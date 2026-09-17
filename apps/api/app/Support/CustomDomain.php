<?php

declare(strict_types=1);

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * A client's own address (docs/custom-domains) — `portal.theirschool.com` rather than the platform
 * handle `theirschool.acadmyq.com`.
 *
 * This is the counterpart of `LmsSite`, which turns a HANDLE into a URL by string concatenation
 * against a known root. A custom domain carries no handle and belongs to no root, so the host has to
 * be LOOKED UP instead of parsed — and that one difference is the whole feature. Everything the
 * lookup answers with (`subdomain`, `kind`) is shaped so the rest of the system never learns that
 * custom domains exist: the resolved handle goes on as `X-Academy` exactly as a subdomain's would.
 *
 * Three jobs:
 *
 *  1. **Resolution** — `resolve()` / `isLive()`, both cached, because they run in front of every
 *     request to every tenant host (including every bot probing the origin IP directly, which is
 *     why the MISS is cached too).
 *  2. **Request-time origin facts** — `origins()` and `isLive()` feed the CORS list, Sanctum's
 *     stateful list and the session cookie domain, none of which can be a static config value once
 *     the set of valid origins is a database table (see AppServiceProvider).
 *  3. **Setup** — `rules()` and `dnsCheck()`: what a host may be, and whether it points at us yet.
 *     Certificate issuance is deliberately NOT here; it needs root and lives in
 *     deploy/bin/acadmyq-issue-certs.sh.
 */
final class CustomDomain
{
    /** Product a domain serves — the per-domain answer to `LmsSite::ownsRoot()`. */
    public const KINDS = ['MANAGEMENT', 'LMS'];

    /** A domain is only an address once DNS points here AND a certificate exists. */
    public const STATUSES = ['PENDING_DNS', 'VERIFIED', 'ISSUING', 'LIVE', 'FAILED'];

    /**
     * An FQDN: at least two labels, DNS-label syntax throughout, and a TLD that is either alphabetic
     * or a punycode (`xn--`) one. IDN labels are allowed on purpose — an Arabic-script domain is a
     * perfectly ordinary thing for this platform's clients to own, and unlike a platform subdomain
     * (where `xn--` is a spoofing surface on OUR name) the client has to prove control of it first.
     */
    public const PATTERN = '/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/';

    /**
     * The DNS resolver, swappable so the verification path can be tested without a network.
     *
     * @var Closure(string): (list<string>|false)|null
     */
    private static ?Closure $resolver = null;

    /** Test seam: answer DNS from `$fn` instead of the network; null restores the real resolver. */
    public static function resolveWith(?Closure $fn): void
    {
        self::$resolver = $fn;
    }

    public static function enabled(): bool
    {
        return (bool) config('custom_domains.enabled', false);
    }

    /** Trim, lowercase, and strip anything a person might paste around a hostname. */
    public static function normalize(mixed $value): ?string
    {
        $host = strtolower(trim((string) $value));
        // `~` delimiters, because `#` is a character these patterns have to MATCH (a fragment).
        $host = (string) preg_replace('~^[a-z]+://~', '', $host);   // a pasted URL
        $host = (string) preg_replace('~[/?#].*$~', '', $host);     // path / query / fragment
        $host = (string) (explode(':', $host)[0] ?? '');             // a port
        $host = trim($host, '.');

        return $host === '' ? null : $host;
    }

    /**
     * Validation rules for a submitted host.
     *
     * Two rules carry the weight, and neither is expressible as a stock rule:
     *
     *  - A host under a platform root is refused. Those addresses already resolve through
     *    `LmsSite::handleFromHost()`, and admitting a second resolver for the same name is how a
     *    client ends up pointing at whichever of the two answered first.
     *  - Uniqueness goes through `app.custom_domain_taken()` rather than `Rule::unique`. A Super
     *    Admin validates with no academy context, so under the table's tenant policy a plain
     *    `unique` rule reads zero rows and passes every duplicate through to the index — a 500
     *    where a sentence belonged.
     *
     * @return list<mixed>
     */
    public static function rules(): array
    {
        return [
            'required', 'string', 'max:253',
            'regex:'.self::PATTERN,
            static function (string $attribute, mixed $value, callable $fail): void {
                $host = self::normalize($value);
                if ($host === null) {
                    return;
                }

                foreach (LmsSite::roots() as $root) {
                    if ($host === $root || str_ends_with($host, '.'.$root)) {
                        $fail("{$root} is the platform's own domain — use the client's handle for that address, not a custom domain.");

                        return;
                    }
                }

                if ((bool) (DB::selectOne('select app.custom_domain_taken(?) as taken', [$host])->taken ?? false)) {
                    $fail("{$host} already belongs to another client.");
                }
            },
        ];
    }

    /**
     * The academy a LIVE host belongs to, or null.
     *
     * @return array{academy_id: string, subdomain: ?string, kind: string}|null
     */
    public static function resolve(?string $host): ?array
    {
        $host = self::normalize($host);
        if ($host === null || ! self::enabled()) {
            return null;
        }

        // The miss is cached with the hit: this runs in front of unauthenticated traffic on a
        // public IP, so "no" is by far the most common answer and it must not cost a query each time.
        $row = Cache::remember(
            'custom-domain:'.$host,
            self::ttl(),
            static function () use ($host): array {
                $found = DB::selectOne('select * from app.academy_by_host(?)', [$host]);

                return $found === null ? ['miss' => true] : [
                    'academy_id' => (string) $found->academy_id,
                    'subdomain' => $found->subdomain !== null ? (string) $found->subdomain : null,
                    'kind' => (string) $found->kind,
                ];
            }
        );

        return isset($row['miss']) ? null : $row;
    }

    /** Is this host one of ours? Cheaper than `resolve()` when only the fact is needed. */
    public static function isLive(?string $host): bool
    {
        $host = self::normalize($host);

        return $host !== null && in_array($host, self::liveHosts(), true);
    }

    /**
     * Every live custom host on the platform.
     *
     * @return list<string>
     */
    public static function liveHosts(): array
    {
        if (! self::enabled()) {
            return [];
        }

        /** @var list<string> */
        return Cache::remember('custom-domains:live', self::ttl(), static fn (): array => array_map(
            static fn (object $r): string => (string) $r->host,
            DB::select('select * from app.live_custom_domains() as host')
        ));
    }

    /**
     * Every live host as a browser ORIGIN, for the CORS allow-list.
     *
     * @return list<string>
     */
    public static function origins(): array
    {
        return array_map(static fn (string $h): string => LmsSite::scheme().'://'.$h, self::liveHosts());
    }

    /**
     * This academy's canonical origin for a product, or null when it has no live domain of that
     * kind. Read under the CALLER's tenant context — `academy_domains` is owner-readable, so a
     * client's own dashboard resolves its own address without a bypass.
     */
    public static function primaryOrigin(string $academyId, string $kind): ?string
    {
        if (! self::enabled()) {
            return null;
        }

        $host = DB::table('academy_domains')
            ->where('academy_id', $academyId)
            ->where('kind', $kind)
            ->where('status', 'LIVE')
            // Primary first, then oldest — a client with one live domain and no primary flag still
            // gets a stable answer rather than whatever the planner returned.
            ->orderByDesc('is_primary')
            ->orderBy('created_at')
            ->value('host');

        return $host !== null ? LmsSite::scheme().'://'.$host : null;
    }

    /**
     * Does this host point at us yet?
     *
     * `gethostbynamel()` follows CNAMEs to the A records they end at, so one call covers both setup
     * shapes — an A record straight to the origin, and a CNAME to our published target. A host
     * behind someone else's proxy resolves to THEIR edge and fails here, which is exactly right:
     * the ACME challenge would not reach us either.
     *
     * @return array{ok: bool, ips: list<string>, error: ?string}
     */
    public static function dnsCheck(string $host): array
    {
        $expected = trim((string) config('custom_domains.origin_ip', ''));
        if ($expected === '') {
            return ['ok' => false, 'ips' => [], 'error' => 'CUSTOM_DOMAINS_ORIGIN_IP is not configured on the server.'];
        }

        $ips = (self::$resolver ?? static fn (string $h) => gethostbynamel($h))($host);
        if ($ips === false || $ips === []) {
            return ['ok' => false, 'ips' => [], 'error' => "{$host} does not resolve yet. DNS changes can take up to an hour."];
        }

        $ips = array_values(array_unique($ips));
        if (! in_array($expected, $ips, true)) {
            return [
                'ok' => false,
                'ips' => $ips,
                'error' => "{$host} resolves to ".implode(', ', $ips)." instead of {$expected}. If it is behind a proxy or CDN, switch that record to DNS-only.",
            ];
        }

        return ['ok' => true, 'ips' => $ips, 'error' => null];
    }

    /**
     * The DNS records a client has to create, as the panel prints them.
     *
     * @return array{origin_ip: string, cname_target: ?string}
     */
    public static function instructions(): array
    {
        $cname = trim((string) config('custom_domains.cname_target', ''));

        return [
            'origin_ip' => trim((string) config('custom_domains.origin_ip', '')),
            'cname_target' => $cname !== '' ? $cname : null,
        ];
    }

    /** Drop the memo for one host and the live-host list — called after any write. */
    public static function forget(?string $host = null): void
    {
        if ($host !== null && ($host = self::normalize($host)) !== null) {
            Cache::forget('custom-domain:'.$host);
        }

        Cache::forget('custom-domains:live');
    }

    private static function ttl(): int
    {
        return max(5, (int) config('custom_domains.cache_seconds', 60));
    }
}
