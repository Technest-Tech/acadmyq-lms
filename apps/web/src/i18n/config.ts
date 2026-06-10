/**
 * i18n configuration (Master Spec R-LOC-1): Arabic (RTL, primary) + English (LTR).
 *
 * MVP uses a single shared URL (R-BRA-1) with the active locale stored in a
 * cookie — no `[locale]` path segments. Default is Arabic, rendered RTL.
 */
export const locales = ["ar", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ar";

/** Cookie next-intl reads on the server to resolve the active locale. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "ar" || value === "en";
}

/** Text/layout direction for a locale (drives the <html dir> attribute). */
export function direction(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
