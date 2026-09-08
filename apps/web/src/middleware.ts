import { type NextRequest, NextResponse } from "next/server";
import { resolveTenantSite } from "@/lib/tenant-site";

/**
 * Per-client subdomain routing. `<handle>.<root>` is ONE address space serving two products, and
 * this is where it is split (docs/lms/02):
 *
 *  - a COURSE-PLATFORM client (the LMS is their whole product) → `/learn/<handle>/…`, the public
 *    course site, exactly as before;
 *  - a MANAGEMENT client (the school runs on the panel — with or without a course catalogue) → the
 *    management app on its own host: `/` becomes the client's BRANDED sign-in, and everything else
 *    passes straight through to the normal app routes, which are host-agnostic (the session cookie
 *    is set on the parent domain, so `<handle>.<root>` and `app.<root>` share one session).
 *
 * The split needs a fact the host name does not carry, so `resolveTenantSite` asks the API once per
 * handle and memoises the answer; it never throws (see that module for the fail-safe order).
 *
 * The handle travels on into the render as `x-academy`, which is what lets the sign-in page paint
 * this client's name and logo server-side — before the first frame, not after a fetch.
 *
 * OPT-IN and fail-safe: with `NEXT_PUBLIC_ROOT_DOMAIN` unset (dev, and until DNS is configured) this
 * is a pure pass-through, so the app host and local development are completely unaffected. Both
 * surfaces also stay reachable directly — `/learn/<handle>/…` and `/login` — for local testing.
 *
 * `NEXT_PUBLIC_ROOT_DOMAIN` is a COMMA-SEPARATED list of roots, canonical one first. One root is the
 * normal case; several exist because a host can be a client address without being able to complete a
 * sign-in — locally `<handle>.lvh.me:3000` signs in (shared registrable parent ⇒ the session cookie
 * travels) while `<handle>.localhost:3000` only renders (Chrome counts it as a different site from
 * the API host, so the cookie never leaves). Matching both means a client host is never mistaken for
 * the marketing site. Link building elsewhere uses the FIRST entry, which is why it is canonical.
 *
 * Each entry may carry a PORT (`localhost:3000`) so the same value can build links; host matching is
 * hostname-only, so ports are stripped here. That is what lets subdomain routing run locally against
 * `http://<academy>.localhost:3000` — browsers and macOS resolve any `*.localhost` label to loopback,
 * so no `/etc/hosts` entry is needed.
 */
const ROOTS = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "")
  .split(",")
  .map((root) => root.split(":")[0]?.trim().toLowerCase() ?? "")
  .filter(Boolean);

// Subdomains that are the platform itself, never an academy handle.
const RESERVED = new Set(["www", "app", "api", "admin", "mail", "static", "assets", "cdn"]);

/** The handle `host` carries under any configured root, or null when it is not a client address. */
function handleFor(host: string): string | null {
  for (const root of ROOTS) {
    if (host === root || !host.endsWith(`.${root}`)) continue;

    const sub = host.slice(0, host.length - root.length - 1);
    if (sub === "" || sub.includes(".") || RESERVED.has(sub)) return null;

    return sub;
  }

  return null;
}

export async function middleware(req: NextRequest) {
  if (ROOTS.length === 0) return NextResponse.next();

  const host = ((req.headers.get("host") ?? "").split(":")[0] ?? "").toLowerCase();

  // `www` is the platform's own marketing site under a second name. Both names serving the same
  // pages splits their search ranking and gives the demo form a second origin the API's CORS list
  // does not know about — so one canonical host, and a permanent redirect from the other.
  const apex = ROOTS.find((root) => host === `www.${root}`);
  if (apex !== undefined) {
    const url = req.nextUrl.clone();
    url.hostname = apex;

    return NextResponse.redirect(url, 308);
  }

  const sub = handleFor(host);
  if (sub === null) return NextResponse.next();

  const url = req.nextUrl;
  // Already the learner path / API / internal → leave alone. The course site builds `/learn/<handle>`
  // hrefs, so rewriting this prefix again would nest it.
  if (url.pathname.startsWith("/learn/") || url.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const site = await resolveTenantSite(sub);

  // A management client's own host IS the management app. Only the root is special: it must open
  // the branded sign-in, not the platform's marketing page. `/login` renders the same screen, so a
  // signed-out visitor deep in the app lands on the branded door too (the shell redirects there).
  if (site?.kind === "MANAGEMENT") {
    const headers = new Headers(req.headers);
    headers.set("x-academy", sub);

    if (url.pathname === "/") {
      url.pathname = "/login";
      return NextResponse.rewrite(url, { request: { headers } });
    }

    return NextResponse.next({ request: { headers } });
  }

  // Course-platform client — and an unknown handle, which lands on the course site's own 404.
  url.pathname = `/learn/${sub}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip Next internals and static files (anything with a dot); run on real page routes.
  matcher: ["/((?!_next/|favicon.ico|.*\\..*).*)"],
};
