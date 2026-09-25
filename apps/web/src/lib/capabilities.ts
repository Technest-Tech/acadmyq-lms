"use client";

import { useAuth } from "@/components/auth-provider";

/**
 * Does the signed-in academy hold `capability`?
 *
 * The answer the sidebar already gives (app-shell's NAV_CAPABILITY), lifted out so a screen can hide
 * a single button the same way: a client gets every feature its modules own, so a MISSING key means
 * a Super Admin switched that feature off for this client (05-MODULES-NOT-PACKAGES §6) and the
 * control should not exist for them. `null` capabilities (a platform Super Admin with no academy
 * entered) gate nothing. The server still enforces the gate (entitled: → 402); this is UX only.
 */
export function useCapability(capability: string): boolean {
  const { session } = useAuth();
  return (
    session?.capabilities == null || session.capabilities.includes(capability)
  );
}
