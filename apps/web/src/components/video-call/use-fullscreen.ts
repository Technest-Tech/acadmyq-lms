"use client";

import { useCallback, useEffect, useState } from "react";

/** The current fullscreen element across vendor prefixes (Safari still ships webkit-prefixed). */
function fullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/**
 * Toggle fullscreen for the whole call surface (`document.documentElement` — the /r/[token] page is
 * dedicated to the call, so the controls stay visible inside it). `supported` is false where the
 * element Fullscreen API is unavailable (notably iOS Safari, which only fullscreens <video>), letting
 * the caller hide the control gracefully. State follows the real `fullscreenchange` event so it stays
 * correct if the user exits with Esc.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const supported =
    typeof document !== "undefined" &&
    !!(
      document.fullscreenEnabled ||
      (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled
    );

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!fullscreenElement());
    onChange();
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (fullscreenElement()) {
        const d = document as Document & { webkitExitFullscreen?: () => Promise<void> };
        await (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      } else {
        const el = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>;
        };
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      // Fullscreen can be rejected (e.g. not a user gesture, or a permissions policy) — no-op.
    }
  }, []);

  return { supported, isFullscreen, toggle };
}
