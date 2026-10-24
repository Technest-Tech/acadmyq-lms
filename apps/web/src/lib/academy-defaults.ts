"use client";

import { useAuth } from "@/components/auth-provider";

/**
 * What a new-person form opens on (Settings → Academy): the academy's country, the dial code that
 * goes with it, and its currency. Empty strings when the academy never set them (or for a platform
 * Super Admin outside an academy), so a form falls back to its own blank exactly as before.
 */
export function useAcademyDefaults(): { country: string; dialCountry: string; currency: string } {
  const { session } = useAuth();
  const country = (session?.academy?.country ?? "").toUpperCase();
  return {
    country,
    dialCountry: country || "SA",
    currency: (session?.academy?.defaultCurrency ?? "").toUpperCase(),
  };
}
