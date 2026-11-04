/**
 * Which digits Arabic text is written in. The product writes Arabic-Indic digits (٠-٩) by default;
 * a learning centre's workspace writes 0-9, the digits its timetables, invoices and phones already
 * use, and in which a large 0 reads as a zero rather than a dot.
 *
 * Module state rather than a prop, because the formatters are plain functions called from hundreds
 * of places. AuthProvider sets it the moment the session arrives, before anything in the shell
 * renders a number. The public pages (a parent's link, a shared invoice) build their own tags and
 * never read this.
 */
let latinDigits = false;

export function setLatinDigits(on: boolean): void {
  latinDigits = on;
}

/** The BCP-47 tag to format a number or date with, in this workspace's digits. */
export function numeralLocale(locale: string): string {
  if (!locale.startsWith("ar") || locale.includes("-nu-")) return locale;
  return `${locale}-u-nu-${latinDigits ? "latn" : "arab"}`;
}
