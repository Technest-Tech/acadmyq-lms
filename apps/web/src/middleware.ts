import { type NextRequest, NextResponse } from "next/server";

/**
 * LMS learner-site subdomain routing (docs/lms/02). Maps `<academy>.<root>/<path>` →
 * `/learn/<academy>/<path>` so each academy's public course site lives on its own subdomain while
 * staying inside this one Next.js app. The `<academy>` segment becomes the tenant the learner API
 * resolves (sent as the `X-Academy` header by the learner-site client).
 *
 * OPT-IN and fail-safe: with `NEXT_PUBLIC_ROOT_DOMAIN` unset (dev, and until DNS is configured) this
 * is a pure pass-through, so the app host and local development are completely unaffected. The
 * learner site is also always reachable directly at `/learn/<academy>/…` for local testing.
 *
 * The variable may carry a PORT (`localhost:3000`) so the same value can build links elsewhere; host
 * matching is hostname-only, so the port is stripped here. That is what lets subdomain routing run
 * locally against `http://<academy>.localhost:3000` — browsers and macOS resolve any `*.localhost`
 * label to loopback, so no `/etc/hosts` entry is needed.
 */
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.split(":")[0]?.toLowerCase();

// Subdomains that are the platform itself, never an academy handle.
const RESERVED = new Set(["www", "app", "api", "admin", "mail", "static", "assets", "cdn"]);

export function middleware(req: NextRequest) {
  if (!ROOT) return NextResponse.next();

  const host = ((req.headers.get("host") ?? "").split(":")[0] ?? "").toLowerCase();
  if (host === ROOT || !host.endsWith(`.${ROOT}`)) return NextResponse.next();

  const sub = host.slice(0, host.length - ROOT.length - 1);
  if (sub === "" || sub.includes(".") || RESERVED.has(sub)) return NextResponse.next();

  const url = req.nextUrl;
  // Already the learner path / API / internal → leave alone.
  if (url.pathname.startsWith("/learn/") || url.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  url.pathname = `/learn/${sub}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip Next internals and static files (anything with a dot); run on real page routes.
  matcher: ["/((?!_next/|favicon.ico|.*\\..*).*)"],
};
