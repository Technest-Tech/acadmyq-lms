"use client";

import { useEffect, useState } from "react";
import type { LearnSiteContent } from "@/lib/learn-api";

/**
 * The live-preview channel between the site builder (`/lms/site`) and the real public site.
 *
 * The builder embeds the client's OWN site in an iframe and posts the unsaved draft into it on
 * every keystroke, so what they are editing and what their students will see are the same pixels —
 * not a mock of them. Nothing here is a rendering path of its own: the site renders exactly as it
 * always does, it just takes its content from a message instead of from the server fetch.
 *
 * Three rules make that safe:
 *  - it only ever activates for a framed document carrying `?preview=1`, so a real visitor's page
 *    never listens for anything;
 *  - only same-origin messages are accepted (the builder loads the site by path, on the dashboard's
 *    own origin, precisely so this check is meaningful);
 *  - nothing is persisted — a draft lives in this frame's state until the builder saves it.
 */

export const PREVIEW_CHANNEL = "academiq:lms-site-preview";

/** Builder → frame. */
export interface PreviewPush {
  channel: typeof PREVIEW_CHANNEL;
  kind: "content";
  content: LearnSiteContent;
  /** An element id (`site-hero`, `site-footer`, …) to bring into view and flash. */
  focus?: string | null;
}

/** Frame → builder: "I'm listening, send me the draft". */
export interface PreviewReady {
  channel: typeof PREVIEW_CHANNEL;
  kind: "ready";
}

/** The query flag the builder appends to the iframe's URL. */
export const PREVIEW_PARAM = "preview";

const FLASH_CLASS = "site-preview-focus";
const FLASH_MS = 1600;

function isPreviewFrame(): boolean {
  if (typeof window === "undefined") return false;
  // A top-level page is never a preview, whatever the query string says.
  if (window.parent === window) return false;
  return new URLSearchParams(window.location.search).has(PREVIEW_PARAM);
}

function focusSection(id: string): void {
  const target = document.getElementById(id);
  if (target === null) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add(FLASH_CLASS);
  window.setTimeout(() => target.classList.remove(FLASH_CLASS), FLASH_MS);
}

/**
 * Returns the draft being previewed, or `null` on every normal page load — which is every page load
 * that isn't the builder's iframe.
 *
 * Links are neutralised while previewing: a click that navigated the frame would strip the preview
 * flag and drop the client onto the *saved* site with no way back. The builder drives which page is
 * shown from its own page picker instead.
 */
export function useSitePreview(): LearnSiteContent | null {
  const [draft, setDraft] = useState<LearnSiteContent | null>(null);

  useEffect(() => {
    if (!isPreviewFrame()) return;

    const origin = window.location.origin;

    function receive(event: MessageEvent) {
      if (event.origin !== origin) return;
      const message = event.data as PreviewPush | undefined;
      if (message?.channel !== PREVIEW_CHANNEL || message.kind !== "content") return;
      setDraft(message.content);
      if (message.focus) {
        // After the draft has painted, so a section that just became visible can be scrolled to.
        window.requestAnimationFrame(() => focusSection(message.focus as string));
      }
    }

    function swallowNavigation(event: MouseEvent) {
      const link = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (link !== null && link !== undefined) event.preventDefault();
    }

    function swallowSubmit(event: SubmitEvent) {
      event.preventDefault();
    }

    window.addEventListener("message", receive);
    document.addEventListener("click", swallowNavigation, true);
    document.addEventListener("submit", swallowSubmit, true);
    document.documentElement.dataset.sitePreview = "on";

    const ready: PreviewReady = { channel: PREVIEW_CHANNEL, kind: "ready" };
    window.parent.postMessage(ready, origin);

    return () => {
      window.removeEventListener("message", receive);
      document.removeEventListener("click", swallowNavigation, true);
      document.removeEventListener("submit", swallowSubmit, true);
      delete document.documentElement.dataset.sitePreview;
    };
  }, []);

  return draft;
}
