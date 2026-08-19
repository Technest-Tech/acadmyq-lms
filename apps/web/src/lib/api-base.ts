/**
 * Where the Laravel API lives, for whoever is asking.
 *
 * `NEXT_PUBLIC_API_URL` takes two shapes:
 *
 *  - an ABSOLUTE origin (`https://api.acadmyq.com`) — production, and anything with a fixed API
 *    host. Returned as-is;
 *  - PORT-ONLY (`:8000`) — "the API is on this same host, at this port". In the browser that
 *    resolves against the page's own hostname, so `noor.localhost:3000` talks to
 *    `noor.localhost:8000` and `alfurqan.lvh.me:3000` to `alfurqan.lvh.me:8000`.
 *
 * The port-only shape exists because of cookies. Sanctum SPA auth needs the API to be same-site with
 * the page, and a client's door lives on a per-client subdomain (docs/lms/02). In production that is
 * free — `noor.acadmyq.com` and `api.acadmyq.com` share `acadmyq.com`. Locally it is not: Chrome
 * counts `noor.localhost` and `localhost` as different sites, so a session cookie set by an API on
 * `localhost` is never sent from `noor.localhost` and sign-in cannot complete at all. Pointing the
 * browser at the API on its OWN host sidesteps the question — same host, so same site by definition,
 * and the cookie is host-only. Every `*.localhost` and `*.lvh.me` label resolves to loopback, so all
 * of them reach the one dev API.
 *
 * On the SERVER (middleware, RSC loaders) there is no page host and no cookie to preserve — those
 * calls are plain server-to-server — so a port-only value resolves against loopback.
 */

const RAW = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").trim();

/** The API origin to call from here: no trailing slash, ready for `${apiBase()}/api/...`. */
export function apiBase(): string {
  if (!RAW.startsWith(":")) return RAW.replace(/\/+$/, "");

  return typeof window === "undefined"
    ? `http://localhost${RAW}`
    : `${window.location.protocol}//${window.location.hostname}${RAW}`;
}
