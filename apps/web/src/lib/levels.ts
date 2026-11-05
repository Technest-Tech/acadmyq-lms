"use client";

import { useContext } from "react";
import { AuthContext } from "@/components/auth-provider";
import type { Session } from "@/lib/api";

/**
 * What an academy calls its classification (docs/centre-profile/02-COHERENCE-AUDIT §3): an English
 * course's LEVELs (A1 … C2), a curriculum centre's GRADEs, a school's YEARs. One academy setting
 * (`academies.level_label`, Settings → Levels), travelling with the session as `academy.levelLabel`.
 */
export type LevelLabel = "LEVEL" | "GRADE" | "YEAR";

export const LEVEL_LABELS: readonly LevelLabel[] = ["LEVEL", "GRADE", "YEAR"];

/**
 * The ONE place a screen learns which word to print for the classification. Every message naming
 * it is an ICU select on `word` — `{word, select, GRADE {…} YEAR {…} other {…}}` — and is called
 * as `t(key, { word: levelWord(session) })`. Anything but GRADE or YEAR (no session, an older
 * session, a Quran academy that never chose) is LEVEL: the wording every screen had before.
 */
export function levelWord(session: Session | null | undefined): LevelLabel {
  return wordOf(session?.academy?.levelLabel);
}

/** The same answer from a stored value — for a page with no session (the parent's page carries it). */
export function wordOf(label: string | null | undefined): LevelLabel {
  return label === "GRADE" || label === "YEAR" ? label : "LEVEL";
}

/** `levelWord` for a component; safe outside an AuthProvider (a shared component under test). */
export function useLevelWord(): LevelLabel {
  return levelWord(useContext(AuthContext)?.session);
}
