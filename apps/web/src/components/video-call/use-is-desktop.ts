import { useSyncExternalStore } from "react";

/**
 * True only inside the AcademIQ Teacher desktop app (apps/desktop), which injects
 * `window.academiqDesktop` via its preload bridge. In every browser — all students and browser
 * teachers — this is false, and all desktop-only behavior keys off it so the web experience stays
 * byte-identical (V-DESK-3).
 *
 * SSR-safe: returns false on the server and during the first hydration render (via the server
 * snapshot), then settles to the real value — no hydration mismatch. The bridge is present from
 * first paint in the desktop app and permanently absent in a browser, so there is nothing to
 * subscribe to.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return typeof window !== "undefined" && !!window.academiqDesktop;
}

function getServerSnapshot(): boolean {
  return false;
}
