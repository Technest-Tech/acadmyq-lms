/**
 * Facts about Acadmyq that are not copy: the public origin, the routes, the commercial offer, and
 * the contact details (if any) the deployment chooses to publish.
 *
 * Everything here is used by BOTH locales, so a price or a URL is written down once and can never
 * drift between the Arabic and English pages — the single most common way a bilingual marketing
 * site starts lying about itself.
 */

/** The public marketing routes. Every nav item, footer link and CTA resolves through this map. */
export const ROUTES = {
  home: "/",
  coursePlatform: "/course-platform",
  academyManagement: "/academy-management",
  contact: "/contact",
  privacy: "/privacy",
  terms: "/terms",
  login: "/login",
} as const;

/**
 * The canonical public origin.
 *
 * Derived from the SAME env var the app already uses to route client subdomains
 * (`NEXT_PUBLIC_ROOT_DOMAIN`, canonical entry first, port allowed for local development) so the
 * marketing site cannot end up canonicalising to a different host than the one the middleware
 * treats as the platform. Falls back to the production apex, which is what `next build` needs when
 * no env is present.
 */
export function siteOrigin(): string {
  const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "")
    .split(",")[0]
    ?.trim();
  if (!root) return "https://acadmyq.com";

  const scheme = process.env.NEXT_PUBLIC_ROOT_SCHEME?.trim() || "https";
  return `${scheme}://${root}`;
}

/** An absolute URL for a marketing path — canonical tags, OG urls and the sitemap all need one. */
export function absoluteUrl(path: string): string {
  return new URL(path, `${siteOrigin()}/`).toString();
}

/**
 * The Course Platform offer, in one place.
 *
 * `firstYear` buys the first year — the branded site, the dashboard and everything switched on.
 * `renewal` is what the following years cost, and it buys HOSTING, MAINTENANCE, UPDATES AND
 * SUPPORT. It is explicitly not a purchase of the software: no source code changes hands and there
 * is no perpetual licence, which is why nothing in the copy says "own it forever".
 */
export const COURSE_PLATFORM_PRICE = {
  firstYearMinor: 499_900,
  renewalMinor: 199_900,
  currency: "EGP",
} as const;

/**
 * Public contact details, published ONLY when the deployment sets them.
 *
 * Deliberately empty by default: an invented support address is worse than no address, and the
 * demo-request form is a real, working channel that needs neither. Set either or both in
 * `apps/web/.env` (and `deploy/env/web.env.template`) to have them appear on the contact page and
 * in the footer.
 */
export const CONTACT = {
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
  phone: process.env.NEXT_PUBLIC_CONTACT_PHONE?.trim() || null,
} as const;

/**
 * The date the privacy policy and terms were last rewritten, as an ISO date.
 *
 * A CONSTANT, never `new Date()`: a legal page's "last updated" line has to say when the words
 * changed, and a page that re-dates itself on every deploy is telling the reader something false
 * about a document they may be relying on. Whoever edits the text bumps this.
 */
export const LEGAL_UPDATED = "2026-09-08";

/** The products a visitor can ask about — the value stored on the lead, and the labels around it. */
export const PRODUCTS = ["COURSE_PLATFORM", "ACADEMY_MANAGEMENT", "UNDECIDED"] as const;

export type ProductInterest = (typeof PRODUCTS)[number];
