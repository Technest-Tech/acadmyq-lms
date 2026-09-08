import { getLocale } from "next-intl/server";
import { isLocale, type Locale } from "@/i18n/config";
import { ar } from "./ar";
import { en } from "./en";
import type { MarketingContent } from "./types";

export * from "./site";
export type * from "./types";

const CATALOG: Record<Locale, MarketingContent> = { ar, en };

/** The marketing copy for one locale. */
export function marketingContent(locale: Locale): MarketingContent {
  return CATALOG[locale];
}

/**
 * The active locale for a server-rendered marketing page.
 *
 * Resolved exactly the way the rest of the app resolves it — next-intl reads the `NEXT_LOCALE`
 * cookie on the server (see `i18n/request.ts`) — so the language switch in the header, the app's
 * own switcher and these pages can never disagree about which language a visitor is reading. There
 * is no `[locale]` path segment anywhere in this app, and the marketing site does not invent one.
 */
export async function activeLocale(): Promise<Locale> {
  const locale = await getLocale();

  return isLocale(locale) ? locale : "ar";
}

/** Convenience for a page: the locale and its content in one await. */
export async function marketing(): Promise<{
  locale: Locale;
  dir: "rtl" | "ltr";
  t: MarketingContent;
}> {
  const locale = await activeLocale();

  return {
    locale,
    dir: locale === "ar" ? "rtl" : "ltr",
    t: marketingContent(locale),
  };
}
