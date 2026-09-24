import { type NextRequest, NextResponse } from "next/server";
import { PATHNAME_HEADER } from "@/lib/request-headers";
import { ROOT_DOMAINS, handleFor, isPlatformHost } from "@/lib/root-domains";
import { resolveTenantSite } from "@/lib/tenant-site";

/**
 * Per-client address routing. A client's host is ONE address space serving two products, and this is
 * where it is split (docs/lms/02):
 *
 *  - a COURSE-PLATFORM client (the LMS is their whole product) → `/learn/<handle>/…`, the public
 *    course site, exactly as before;
 *  - a MANAGEMENT client (the school runs on the panel — with or without a course catalogue) → the
 *    management app on its own host: `/` becomes the client's BRANDED sign-in, and everything else
 *    passes straight through to the normal app routes, which are host-agnostic (the session cookie
 *    is set on the parent domain, so `<handle>.<root>` and `app.<root>` share one session).
 *
 * The split needs a fact the host name does not carry, so `resolveTenantSite` asks the API once per
 * address and memoises the answer; it never throws (see that module for the fail-safe order).
 *
 * The handle travels on into the render as `x-academy`, which is what lets the sign-in page paint
 * this client's name and logo server-side — before the first frame, not after a fetch.
 *
 * ## Two kinds of client address
 *
 * `<handle>.<root>` SPELLS its handle, so the router reads it off the host. A client's OWN domain
 * (docs/custom-domains) spells nothing — `portal.theirschool.com` is just a name someone pointed at
 * our IP — so it is LOOKED UP instead, and the lookup answers with the same handle the platform
 * address would have carried. That is the whole difference: past this file, nothing downstream can
 * tell the two apart.
 *
 * Which product answers also moves with the address. On the platform subdomain the client's PLAN
 * decides (a course-platform client's site owns `/`); on a domain they bought, the domain's own
 * `kind` decides, because a client buys an address for a purpose — which is how one school can run
 * its panel on `portal.school.com` and its course site on `courses.school.com`.
 *
 * OPT-IN and fail-safe: with `NEXT_PUBLIC_ROOT_DOMAIN` unset (dev, and until DNS is configured) this
 * is a pure pass-through, so the app host and local development are completely unaffected. Custom
 * domains carry a SECOND switch, `NEXT_PUBLIC_CUSTOM_DOMAINS`, mirroring the API's
 * `CUSTOM_DOMAINS_ENABLED`: off, a host under no configured root is simply not a client address,
 * which is what it was before this feature existed. Both surfaces also stay reachable directly —
 * `/learn/<handle>/…` and `/login` — for local testing.
 *
 * `NEXT_PUBLIC_ROOT_DOMAIN` is a COMMA-SEPARATED list of roots, canonical one first (see
 * lib/root-domains). One root is the normal case; several exist because a host can be a client
 * address without being able to complete a sign-in — locally `<handle>.lvh.me:3000` signs in
 * (shared registrable parent ⇒ the session cookie travels) while `<handle>.localhost:3000` only
 * renders (Chrome counts it as a different site from the API host, so the cookie never leaves).
 * Matching both means a client host is never mistaken for the marketing site.
 */
const CUSTOM_DOMAINS = (process.env.NEXT_PUBLIC_CUSTOM_DOMAINS ?? "").trim() === "1";

export async function middleware(req: NextRequest) {
  // The route that will actually render, forwarded to the root layout (see lib/request-headers).
  // Set on EVERY branch below, and re-set before a rewrite so it names the REWRITTEN path — a
  // client's course site is served from `/learn/<handle>`, not from the `/` the visitor typed.
  const headers = new Headers(req.headers);
  headers.set(PATHNAME_HEADER, req.nextUrl.pathname);
  /** Pass the request through untouched apart from the headers we add to it. */
  const pass = () => NextResponse.next({ request: { headers } });

  if (ROOT_DOMAINS.length === 0) return pass();

  const host = ((req.headers.get("host") ?? "").split(":")[0] ?? "").toLowerCase();

  // `www` is the platform's own marketing site under a second name. Both names serving the same
  // pages splits their search ranking and gives the demo form a second origin the API's CORS list
  // does not know about — so one canonical host, and a permanent redirect from the other.
  const apex = ROOT_DOMAINS.find((root) => host === `www.${root}`);
  if (apex !== undefined) {
    const url = req.nextUrl.clone();
    url.hostname = apex;

    return NextResponse.redirect(url, 308);
  }

  const url = req.nextUrl;
  // Already the learner path / API / internal → leave alone. The course site builds `/learn/<handle>`
  // hrefs, so rewriting this prefix again would nest it. Checked before any lookup, for both kinds
  // of client address: these paths are routed correctly however the visitor arrived.
  // `/i/<token>` is the public invoice / payment page: payment messages link it on the academy's
  // own address, and it must render there whichever product that host serves — a course-platform
  // client's host would otherwise rewrite it into `/learn/<handle>/i/…`, a 404.
  const routedAlready =
    url.pathname.startsWith("/learn/") ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/i/");

  /**
   * Serve `handle`'s product on this host. Identical for both kinds of address — the only thing the
   * two paths above disagree about is how they found the handle.
   */
  const serve = (kind: string | undefined, handle: string) => {
    // A management client's own host IS the management app. Only the root is special: it must open
    // the branded sign-in, not the platform's marketing page. `/login` renders the same screen, so a
    // signed-out visitor deep in the app lands on the branded door too (the shell redirects there).
    if (kind === "MANAGEMENT") {
      headers.set("x-academy", handle);

      if (url.pathname === "/") {
        url.pathname = "/login";
        headers.set(PATHNAME_HEADER, url.pathname);

        return NextResponse.rewrite(url, { request: { headers } });
      }

      return pass();
    }

    // Course-platform client — and, on a platform subdomain, an unknown handle, which lands on the
    // course site's own 404.
    url.pathname = `/learn/${handle}${url.pathname === "/" ? "" : url.pathname}`;
    headers.set(PATHNAME_HEADER, url.pathname);

    return NextResponse.rewrite(url, { request: { headers } });
  };

  const sub = handleFor(host);
  if (sub !== null) {
    if (routedAlready) return pass();

    const site = await resolveTenantSite(sub);

    return serve(site?.kind, sub);
  }

  // No handle in the host. Either it is the platform's own address (the apex, `app.`, `api.` …),
  // or it is a name someone pointed at us — a client's own domain, or a stranger's.
  if (isPlatformHost(host) || !CUSTOM_DOMAINS) return pass();
  if (routedAlready) return pass();

  const site = await resolveTenantSite({ host });
  const handle = site?.academy.subdomain ?? null;

  // A host we do not recognise gets an honest 404 rather than the marketing site. The catch-all
  // vhost means ANY domain aimed at this IP reaches us, and serving those the platform's own pages
  // would put a second, unasked-for copy of the marketing site on every one of them.
  if (site === null || handle === null) {
    return new NextResponse("Not found", { status: 404 });
  }

  return serve(site.kind, handle);
}

export const config = {
  // Skip Next internals and static files (anything with a dot); run on real page routes.
  matcher: ["/((?!_next/|favicon.ico|.*\\..*).*)"],
};
