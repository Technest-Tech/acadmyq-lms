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
 */

import { apiBase } from "@/lib/api-base";
/** How long an answer is served without re-asking, and how long a stale one may rescue an outage. */
const FRESH_MS = 60_000;
const STALE_MS = 24 * 60 * 60_000;

export type SiteKind = "MANAGEMENT" | "LMS";

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
 * Resolve a subdomain handle → the site it serves. `null` means the handle resolves to no academy,
 * which is a real 404 (the site does not exist for that host).
 */
export async function resolveTenantSite(
  handle: string,
): Promise<TenantSite | null> {
  const key = handle.toLowerCase();
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < FRESH_MS) return cached.value;

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/site`, {
      headers: { Accept: "application/json", "X-Academy": key },
      // Honoured where a data cache exists (the page render); inert in middleware, which is what
      // the map above covers.
      next: { revalidate: 60, tags: [`tenant-site:${key}`] },
    });
  } catch {
    if (cached && now - cached.at < STALE_MS) return cached.value;
    return unbranded(key);
  }

  if (res.status === 404) {
    cache.set(key, { value: null, at: now });
    return null;
  }

  if (!res.ok) {
    if (cached && now - cached.at < STALE_MS) return cached.value;
    return unbranded(key);
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
      subdomain: body.academy?.subdomain ?? key,
      status: body.academy?.status ?? "",
    },
  };

  cache.set(key, { value: site, at: now });
  return site;
}

/** Test seam: drop the memo so a case can change what the API answers. */
export function __clearTenantSiteCache(): void {
  cache.clear();
}
