/**
 * Who the storefront says it is (docs/lms/09 §1).
 *
 * Every LMS client renders the same template, so the ONE thing that must never look unfinished is
 * the name in the header, the footer, the page title and half the default copy. Three things can be
 * true when the site renders:
 *
 *  1. the client wrote a brand name — use it, always;
 *  2. they wrote nothing, and the academy row carries a real business name — use that;
 *  3. neither is a name at all, only the URL handle the platform assigned them (`lms`, `noor`,
 *     `academy-2`) — which is a slug, not a brand, and putting it in 48px type at the top of a
 *     public page ("تعلّم مع lms") is the single most amateur thing this template can do.
 *
 * Case 3 is not hypothetical: an academy created for the course platform is normally seeded with
 * its subdomain as its name, so it is the DEFAULT state of a brand-new client. The rule below is
 * therefore deliberate rather than defensive — a name that is merely the address is treated as no
 * name, and the caller substitutes translated neutral copy ("المنصة التعليمية" / "The learning
 * platform"), which reads as a considered choice instead of a leaked internal identifier.
 *
 * The moment the client types a real name in the site editor it wins, in every language, with no
 * further logic — which is the whole point of keeping this in one pure function.
 */

/** Lowercase, strip everything that is not a letter or digit — "Noor Academy" ⇒ "nooracademy". */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Is this "name" just the site's own URL handle? Compared folded, so `Al-Furqan`, `alfurqan` and
 * `AL FURQAN` all match the handle `alfurqan` — a client whose real brand happens to read exactly
 * like their subdomain is indistinguishable from one who never set a name, and in that case the
 * neutral fallback is still the better of the two outcomes.
 */
export function isHandleName(name: string, handle: string): boolean {
  const folded = fold(name);
  return folded !== "" && folded === fold(handle);
}

/**
 * The display name for a storefront, or `null` when the client has supplied no real one and the
 * caller should render its own translated fallback.
 *
 * @param brandName   `site.brand.name` — what the client typed in the site editor.
 * @param academyName the academies row's name, the only identity a fresh client has.
 * @param handle      the subdomain / route segment this site answers on.
 */
export function resolveSiteName(
  brandName: string | null | undefined,
  academyName: string | null | undefined,
  handle: string,
): string | null {
  for (const candidate of [brandName, academyName]) {
    const value = (candidate ?? "").trim();
    if (value !== "" && !isHandleName(value, handle)) return value;
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
