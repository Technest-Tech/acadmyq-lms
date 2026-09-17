/**
 * Which product answers on a client's subdomain — the one resolver both the middleware and the
 * branded sign-in page read (docs/lms/02).
 *
 * `<handle>.<root>` is a single address space serving two products: the public COURSE SITE for a
 * course-platform client, and the MANAGEMENT system's own branded sign-in (and the panel behind it)
 * for everyone else. Nothing in the host name says which, so the API is asked once per handle and
 * the answer is cached — this runs in middleware, on every request to every tenant host.
 *
 * Two caches, because middleware and the page render in separate runtimes with separate module
 * instances; each keeps its own map, both are tiny (one small object per client).
 *
 * Fail-safe, in this order:
 *  - a FRESH entry (< 60s) answers with no network at all;
 *  - the API answering 404 means the handle belongs to nobody → `null`, and the caller 404s;
 *  - the API being unreachable falls back to the last known answer for that handle (up to a day
 *    old), and only if there has never been one does it assume MANAGEMENT — the login page renders
 *    correctly unbranded, whereas guessing "course site" would show a stranger's 404 to a client
 *    whose whole product is the panel.
 *
 * A client's OWN domain (docs/custom-domains) is looked up the same way, keyed by the full host
 * instead of a handle — the host is all such a request carries. One asymmetry, in that last
 * fail-safe: an unknown HANDLE arrived through our own wildcard DNS, so assuming it is a client is
 * safe, while an unknown HOST is any address on the internet someone pointed at our IP. Guessing
 * there would serve a stranger's domain a branded login page, so a host with no known answer stays
 * `null` and the router 404s it.
 */

import { apiBase } from "@/lib/api-base";
/** How long an answer is served without re-asking, and how long a stale one may rescue an outage. */
const FRESH_MS = 60_000;
const STALE_MS = 24 * 60 * 60_000;

export type SiteKind = "MANAGEMENT" | "LMS";

/**
 * How a site is addressed: a platform handle (`noor`) or a client's own host
 * (`{ host: "portal.noor.edu" }`). The bare-string form is the original one and stays the default.
 */
export type SiteKey = string | { host: string };

export interface TenantSite {
  kind: SiteKind;
  academy: {
    name: string;
    displayName: string;
    logoUrl: string | null;
    subdomain: string | null;
    status: string;
  };
}

interface Entry {
  value: TenantSite | null;
  at: number;
}

const cache = new Map<string, Entry>();

/** The answer used when the API is unreachable and this handle has never resolved (see above). */
function unbranded(handle: string): TenantSite {
  return {
    kind: "MANAGEMENT",
    academy: {
      name: "",
      displayName: "",
      logoUrl: null,
      subdomain: handle,
      status: "",
    },
  };
}

/**
 * Resolve an address → the site it serves. `null` means it resolves to no academy, which is a real
 * 404 (the site does not exist for that host).
 */
export async function resolveTenantSite(
  key: SiteKey,
): Promise<TenantSite | null> {
  const byHost = typeof key !== "string";
  const value = (typeof key === "string" ? key : key.host).toLowerCase();
  // Namespaced so a handle and a host can never collide in one map.
  const cacheKey = byHost ? `host:${value}` : `handle:${value}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.at < FRESH_MS) return cached.value;

  /** The last known answer, or — for a host we have never resolved — nothing at all. See above. */
  const onOutage = (): TenantSite | null => {
    if (cached && now - cached.at < STALE_MS) return cached.value;
    return byHost ? null : unbranded(value);
  };

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/site`, {
      headers: {
        Accept: "application/json",
        ...(byHost ? { "X-Academy-Host": value } : { "X-Academy": value }),
      },
      // Honoured where a data cache exists (the page render); inert in middleware, which is what
      // the map above covers.
      next: { revalidate: 60, tags: [`tenant-site:${cacheKey}`] },
    });
  } catch {
    return onOutage();
  }

  if (res.status === 404) {
    cache.set(cacheKey, { value: null, at: now });
    return null;
  }

  if (!res.ok) {
    return onOutage();
  }

  const body = (await res.json()) as {
    kind?: string;
    academy?: {
      name?: string;
      display_name?: string;
      logo_url?: string | null;
      subdomain?: string | null;
      status?: string;
    };
  };

  const site: TenantSite = {
    kind: body.kind === "LMS" ? "LMS" : "MANAGEMENT",
    academy: {
      name: body.academy?.name ?? "",
      displayName: body.academy?.display_name || (body.academy?.name ?? ""),
      logoUrl: body.academy?.logo_url || null,
      // For a host lookup this is the ANSWER, not the key: a custom domain resolves to the client's
      // platform handle, which is what the router forwards on as `x-academy` and what the course
      // site is served from. Falling back to the key would name a host where a handle belongs.
      subdomain: body.academy?.subdomain ?? (byHost ? null : value),
      status: body.academy?.status ?? "",
    },
  };

  cache.set(cacheKey, { value: site, at: now });
  return site;
}

/** Test seam: drop the memo so a case can change what the API answers. */
export function __clearTenantSiteCache(): void {
  cache.clear();
}
