"use client";

import { createContext, useContext } from "react";
import type { AuthMode } from "@/components/learn/auth-forms";
import type {
  LearnProfile,
  LearnSiteCommerce,
  LearnSiteContent,
  LearnSiteStats,
} from "@/lib/learn-api";

/**
 * The public course site's shared state (docs/lms/09) — the academy's content plus the current
 * learner. It lives here, not next to the provider, so the chrome and the section kit can read it
 * without importing the route file that renders them (which would be an import cycle).
 */
export interface LearnContextValue {
  academy: string;
  /** The academy's version of the shared template — brand, section copy, contact details. */
  site: LearnSiteContent;
  /** Live catalogue counters, for the stats band's fallback numbers. */
  stats: LearnSiteStats;
  /**
   * Which ways into a course this client actually offers — what the hero's CTAs, the FAQ and the
   * footer adapt to. Always present here (the provider substitutes an all-off block), so callers
   * never branch on "did the API tell us".
   */
  commerce: LearnSiteCommerce;
  /**
   * Display name, already resolved: the client's brand name → the academy's name → translated
   * neutral copy. Never the subdomain handle — see lib/learn-brand.ts for why that matters.
   */
  siteName: string;
  /** The site's own canonical origin, when subdomain routing is configured. */
  siteUrl: string | null;
  learner: LearnProfile | null;
  enrolled: Set<string>;
  loading: boolean;
  isEnrolled: (courseId: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Run `then` once signed in, opening the auth modal first if the visitor is anonymous.
   *
   * `intent` is what they were about to do ("Sign in to continue to “Tajweed — Level 1”"), shown
   * above the form: an unexplained sign-in wall in the middle of buying a course is where people
   * leave, and the callback is what puts them back exactly where they were afterwards.
   */
  requireAuth: (then?: () => void, intent?: string) => void;
  openAuth: (mode?: AuthMode) => void;
  openRedeem: () => void;
}

export const LearnContext = createContext<LearnContextValue | null>(null);

export function useLearn(): LearnContextValue {
  const ctx = useContext(LearnContext);
  if (ctx === null) throw new Error("useLearn must be used inside LearnProvider");
  return ctx;
}

/** Absolute path helper — every link on the site is relative to the academy's route segment. */
export function useLearnHref(): (path?: string) => string {
  const { academy } = useLearn();
  return (path = "") => `/learn/${academy}${path}`;
}
