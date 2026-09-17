/**
 * The platform's own root domains, and the one question every host-shaped decision starts from:
 * is this address ours, or the client's?
 *
 * `NEXT_PUBLIC_ROOT_DOMAIN` is a comma-separated list, canonical first, each entry optionally
 * carrying a port (`lvh.me:3000`) so the same value can build links. Host matching is hostname-only,
 * so ports are stripped here — see the middleware for why more than one root exists.
 *
 * Extracted from the middleware because three places now need the same answer: the router (which
 * client does this host belong to), the API client (`lib/api-base` — a client's own domain serves
 * the API from its own origin, or the session cookie never travels), and anything building a link.
 * Two copies of "is this host ours" is how a custom domain ends up half-configured.
 */
export const ROOT_DOMAINS: readonly string[] = (
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? ""
)
  .split(",")
  .map((root) => root.split(":")[0]?.trim().toLowerCase() ?? "")
  .filter(Boolean);

/** Subdomains that are the platform itself, never an academy handle. */
const RESERVED = new Set(["www", "app", "api", "admin", "mail", "static", "assets", "cdn"]);

/** Is this host the platform's own — an apex, or anything under one of its roots? */
export function isPlatformHost(host: string): boolean {
  const h = host.toLowerCase();

  return ROOT_DOMAINS.some((root) => h === root || h.endsWith(`.${root}`));
}

/**
 * The client handle `host` carries under a platform root, or null when it carries none — either
 * because it is a reserved platform name, or because it is not under a root at all (which is what a
 * client's OWN domain looks like, and is resolved by lookup instead; see lib/tenant-site).
 */
export function handleFor(host: string): string | null {
  for (const root of ROOT_DOMAINS) {
    if (host === root || !host.endsWith(`.${root}`)) continue;

    const sub = host.slice(0, host.length - root.length - 1);
    if (sub === "" || sub.includes(".") || RESERVED.has(sub)) return null;

    return sub;
  }

  return null;
}
