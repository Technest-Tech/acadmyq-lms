"use client";

import { useContext } from "react";
import { AuthContext, useAuth } from "@/components/auth-provider";
import type { AcademyKind } from "@/lib/api";

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

/**
 * Which kind of school the signed-in academy is (`SessionAcademy.profile`): QURAN — the one-to-one
 * academy — or CENTRE — a learning centre that teaches groups. The profile shapes the WORKSPACE
 * (sidebar order, dashboard, wording) and nothing else: a behaviour that differs between the two
 * keys on its own feature switch through `useCapability`, never on this. A session with no academy
 * (a platform Super Admin), or one from before profiles existed, reads as QURAN.
 */
export function useProfile(): AcademyKind {
  const { session } = useAuth();
  return session?.academy?.profile ?? "QURAN";
}

/**
 * Do the online surfaces — the Enter button, the teacher's meeting link, the Punctuality tab — exist
 * here? Only a centre can be without them (`centre` + `academy.onlineLessons` false, the setting or
 * its automatic answer); every other academy keeps them whatever it set, and an older session reads
 * as yes. Safe outside an AuthProvider, so a shared component can ask.
 */
export function useOnlineLessons(): boolean {
  const session = useContext(AuthContext)?.session;
  return !(session?.capabilities?.includes("centre") && session.academy?.onlineLessons === false);
}

/**
 * Is this workspace in a learning centre's look (`centre-look.css`)? Safe outside an AuthProvider, so a
 * shared component can ask without every test around it having to supply a session.
 */
export function useCentreLook(): boolean {
  return useContext(AuthContext)?.session?.academy?.profile === "CENTRE";
}

/**
 * Is this workspace in the modern design (`html[data-look="modern"]`, centre-look.css)? A centre always
 * is; any other academy only once a Super Admin switched `modern_look` on for it. The look and nothing
 * else: a behaviour never keys on this, and `useCentreLook` stays the centre's own question. Safe outside
 * an AuthProvider.
 */
export function useModernLook(): boolean {
  const session = useContext(AuthContext)?.session;
  return session?.academy?.profile === "CENTRE" || (session?.capabilities?.includes("modern_look") ?? false);
}
