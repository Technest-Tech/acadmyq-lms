/**
 * Who the storefront says it is (docs/lms/09 §1).
 *
 * Every LMS client renders the same template, so the name in the header, the footer, the page title
 * and half the default copy is the one thing that must never look unfinished. Two things can be
 * true when the site renders:
 *
 *  1. the client wrote a brand name in the site editor — use it, always;
 *  2. they wrote nothing — use the academy's own name, the identity the platform assigned the
 *     client when it was created.
 *
 * Only a client with neither gets the translated neutral copy ("المنصة التعليمية" / "The learning
 * platform").
 *
 * This used to throw away a name that folded to the site's URL handle as well, on the theory that
 * `zad` at `zad.acadmyq.com` was a leaked slug rather than a brand. It is not: a one-word brand and
 * a handle chosen to match it are the ordinary case, and the rule fired on a live client, replacing
 * the name the owner had just assigned with generic copy on the client's own public site. An
 * assigned name wins now — short, lowercase and handle-shaped included. The cure for an ugly one is
 * to rename the client (or type a brand name in the site editor), not to hide it.
 */

/**
 * The display name for a storefront, or `null` when the client has no name at all and the caller
 * should render its own translated fallback.
 *
 * @param brandName   `site.brand.name` — what the client typed in the site editor.
 * @param academyName the academies row's name, assigned when the client was created.
 */
export function resolveSiteName(
  brandName: string | null | undefined,
  academyName: string | null | undefined,
): string | null {
  for (const candidate of [brandName, academyName]) {
    const value = (candidate ?? "").trim();
    if (value !== "") return value;
  }
  return null;
}

/**
 * Alt text for a tenant's logo. The logo IS the name, so when it carries one the image is decorative
 * and an empty alt keeps a screen reader from hearing the brand twice; only a logo standing alone
 * needs to be announced.
 */
export function logoAlt(siteName: string, standalone: boolean): string {
  return standalone ? siteName : "";
}
