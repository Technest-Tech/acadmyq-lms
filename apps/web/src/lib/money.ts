import type { Money } from "@academiq/contracts";

/**
 * Display-only money formatting (Master Spec §6.3). The API sends integer minor
 * units; this is the single render boundary that scales to major units for the
 * Intl formatter. NO business math happens on the client — money math lives in
 * the PHP `MoneyMinorUnits` value object only.
 *
 * @param locale BCP-47 locale (e.g. "ar", "en"); drives digits + symbol placement.
 */
export function formatMoney(money: Money, locale: string): string {
  const { amount, currency } = money;
  // Display scaling only (assumes 2-decimal minor units for MVP currencies).
  const major = amount / 100;

  // Arabic locales render Eastern Arabic (Arabic-Indic) numerals (٠-٩); modern
  // CLDR defaults plain "ar" to Latin digits, so request the numbering system.
  const bcp47 =
    locale.startsWith("ar") && !locale.includes("-nu-")
      ? `${locale}-u-nu-arab`
      : locale;

  return new Intl.NumberFormat(bcp47, {
    style: "currency",
    currency,
  }).format(major);
}

/**
 * Locale-aware plain-number formatting (counts, limits, usage). Mirrors formatMoney's
 * numbering-system handling so Arabic renders Eastern Arabic (Arabic-Indic) digits (٠-٩)
 * rather than the Latin digits modern CLDR defaults plain "ar" to (R-LOC / AC-9.12).
 */
export function formatNumber(value: number, locale: string): string {
  const bcp47 =
    locale.startsWith("ar") && !locale.includes("-nu-")
      ? `${locale}-u-nu-arab`
      : locale;

  return new Intl.NumberFormat(bcp47).format(value);
}
