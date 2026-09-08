import type { Money } from "@academiq/contracts";

export interface MoneyFormatOptions {
  /**
   * Drop `.00` on a whole amount — "400 ج.م", not "400.00 ج.م".
   *
   * OFF by default, and deliberately so: on a ledger (invoices, payouts, receipts) the aligned
   * decimals are what make a column of figures readable, and a total that silently changes width
   * looks like a different kind of number. A STOREFRONT price is the opposite case — it is a
   * headline, and every shop in the world writes it without the zeros. So the storefront opts in
   * and nothing else has to change.
   */
  trimZeroDecimals?: boolean;
}

/**
 * Display-only money formatting (Master Spec §6.3). The API sends integer minor
 * units; this is the single render boundary that scales to major units for the
 * Intl formatter. NO business math happens on the client — money math lives in
 * the PHP `MoneyMinorUnits` value object only.
 *
 * @param locale BCP-47 locale (e.g. "ar", "en"); drives digits + symbol placement.
 */
export function formatMoney(
  money: Money,
  locale: string,
  options: MoneyFormatOptions = {},
): string {
  const { amount, currency } = money;
  // Display scaling only (assumes 2-decimal minor units for MVP currencies).
  const major = amount / 100;

  // Arabic locales render Eastern Arabic (Arabic-Indic) numerals (٠-٩); modern
  // CLDR defaults plain "ar" to Latin digits, so request the numbering system.
  const bcp47 =
    locale.startsWith("ar") && !locale.includes("-nu-")
      ? `${locale}-u-nu-arab`
      : locale;

  // Only a WHOLE amount loses its decimals: 400 → "400 ج.م", but 399.50 keeps them, because
  // rounding a real price away would misstate it.
  const whole = options.trimZeroDecimals === true && Number.isInteger(major);

  return new Intl.NumberFormat(bcp47, {
    style: "currency",
    currency,
    ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
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
