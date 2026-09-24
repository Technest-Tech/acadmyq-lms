"use client";

import { useCallback } from "react";
import { useAuth } from "@/components/auth-provider";

/**
 * Builds the public invoice / payment link on the ACADEMY's own address (its custom domain or
 * `<handle>.<root>`, from `/auth/me`), not whatever host this tab happens to be on — a link copied
 * on the platform domain must still send the payer to the academy's site. Falls back to the
 * current origin for a session without an academy.
 */
export function useInvoiceUrl(): (token: string) => string {
  const { session } = useAuth();
  const origin = session?.academy?.publicOrigin;

  return useCallback(
    (token: string) => {
      const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
      return `${base}/i/${token}`;
    },
    [origin],
  );
}
