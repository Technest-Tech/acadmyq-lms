"use client";

import { createContext, useContext } from "react";
import type { AuthMode } from "@/components/learn/auth-forms";
import type { LearnProfile, LearnSiteContent, LearnSiteStats } from "@/lib/learn-api";

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
  /** Display name, already resolved: brand name → academy name → subdomain handle. */
  siteName: string;
  learner: LearnProfile | null;
  enrolled: Set<string>;
  loading: boolean;
  isEnrolled: (courseId: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Run `then` once signed in, opening the auth modal first if the visitor is anonymous. */
  requireAuth: (then?: () => void) => void;
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
