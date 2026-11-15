"use client";

import { useLocale } from "next-intl";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AuthContext } from "@/components/auth-provider";
import type { HelpContent, HelpViewer } from "@/content/help/types";
import { getHelpVideos, type HelpVideo } from "@/lib/help-api";

/**
 * What the help reads: who is asking, the words in their language, and the videos recorded so far.
 * Apart from the provider so the drawer, the help centre and the Super Admin screen can each read
 * them without importing one another.
 */

/** The signed-in person as the help sees them. Safe outside an AuthProvider. */
export function useHelpViewer(): HelpViewer {
  const session = useContext(AuthContext)?.session ?? null;
  return useMemo(
    () => ({
      permissions: session?.permissions ?? [],
      capabilities: session?.capabilities ?? null,
      profile: session?.academy?.profile ?? "QURAN",
    }),
    [session],
  );
}

const CONTENT = new Map<string, HelpContent>();

/**
 * The help's words in the current language — its own chunk per language, fetched on first use and
 * kept for the rest of the visit. `null` while it loads.
 */
export function useHelpContent(enabled = true): HelpContent | null {
  const locale = useLocale() === "en" ? "en" : "ar";
  const [content, setContent] = useState<HelpContent | null>(() => CONTENT.get(locale) ?? null);

  useEffect(() => {
    if (!enabled) return;
    const cached = CONTENT.get(locale);
    if (cached !== undefined) {
      setContent(cached);
      return;
    }
    let live = true;
    const load = locale === "en" ? import("@/content/help/en") : import("@/content/help/ar");
    void load.then((module) => {
      CONTENT.set(locale, module.default);
      if (live) setContent(module.default);
    });
    return () => {
      live = false;
    };
  }, [locale, enabled]);

  return content;
}

/** An uploaded video's signed url outlives this many minutes with room to spare (the API mints 240). */
const VIDEOS_FRESH_MS = 30 * 60_000;
let videosCache: { at: number; bySlot: Map<string, HelpVideo> } | null = null;

/** Forget the cached video list — after the Super Admin screen attaches or removes one. */
export function forgetHelpVideos(): void {
  videosCache = null;
}

/**
 * The recorded videos by slot. A slot missing from the map has no video yet — which is every slot
 * on day one, and never an error: a failed read just leaves the "coming soon" cards up.
 */
export function useHelpVideos(enabled = true): { videos: ReadonlyMap<string, HelpVideo>; reload: () => void } {
  const [videos, setVideos] = useState<ReadonlyMap<string, HelpVideo>>(() => videosCache?.bySlot ?? new Map());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (videosCache !== null && Date.now() - videosCache.at < VIDEOS_FRESH_MS) {
      setVideos(videosCache.bySlot);
      return;
    }
    let live = true;
    getHelpVideos()
      .then((result) => {
        const bySlot = new Map(result.videos.map((video) => [video.slot, video]));
        videosCache = { at: Date.now(), bySlot };
        if (live) setVideos(bySlot);
      })
      .catch(() => {
        // No videos is the normal state; the written steps stand on their own.
      });
    return () => {
      live = false;
    };
  }, [enabled, tick]);

  const reload = useCallback(() => {
    forgetHelpVideos();
    setTick((n) => n + 1);
  }, []);

  return { videos, reload };
}
