import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import {
  LearnContext,
  type LearnContextValue,
} from "@/components/learn/context";
import type { LearnSiteCommerce, LearnSiteContent } from "@/lib/learn-api";
import { emptySiteContent } from "@/lib/learn-server";
import arMessages from "../../messages/ar.json";
import enMessages from "../../messages/en.json";

/**
 * Rendering a piece of the LMS storefront in a test (docs/lms/09).
 *
 * The site document is 15 blocks deep, and every component under `components/learn` reads some of
 * it, so a test that builds the object by hand spends more lines on the fixture than on the
 * assertion — and breaks the moment a new field lands. This builds on the SAME
 * `emptySiteContent()` the real outage path uses, so the fixture can never drift from the schema:
 * add a field to the document and every test keeps compiling.
 */

/** A deep partial — a test overrides the two fields it cares about, not a whole block. */
type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : T[K] };

function overlay<T>(base: T, patch: Deep<T> | undefined): T {
  if (patch === undefined) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key];
    out[key] =
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
        ? overlay(current, value as Deep<unknown>)
        : value;
  }
  return out as T;
}

export const NO_COMMERCE: LearnSiteCommerce = {
  free: false,
  free_course: null,
  checkout: false,
  codes: false,
  paid: false,
};

export function siteFixture(patch?: Deep<LearnSiteContent>): LearnSiteContent {
  return overlay(emptySiteContent(""), patch);
}

export interface LearnFixture {
  site?: Deep<LearnSiteContent>;
  commerce?: Partial<LearnSiteCommerce>;
  value?: Partial<LearnContextValue>;
  locale?: "ar" | "en";
}

export function learnValue(fixture: LearnFixture = {}): LearnContextValue {
  return {
    academy: "noor",
    site: siteFixture(fixture.site),
    stats: { courses: 0, lessons: 0, learners: 0, certificates: 0 },
    commerce: { ...NO_COMMERCE, ...fixture.commerce },
    siteName: "Noor",
    siteUrl: null,
    learner: null,
    enrolled: new Set<string>(),
    loading: false,
    isEnrolled: () => false,
    refresh: async () => {},
    logout: async () => {},
    requireAuth: (then) => then?.(),
    openAuth: () => {},
    openRedeem: () => {},
    ...fixture.value,
  };
}

/** Render `children` inside a storefront: one academy's content, one locale, real messages. */
export function renderInSite(
  children: ReactNode,
  fixture: LearnFixture = {},
): { value: LearnContextValue } {
  const value = learnValue(fixture);
  const locale = fixture.locale ?? "en";

  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? arMessages : enMessages}
    >
      <LearnContext.Provider value={value}>{children}</LearnContext.Provider>
    </NextIntlClientProvider>,
  );

  return { value };
}
