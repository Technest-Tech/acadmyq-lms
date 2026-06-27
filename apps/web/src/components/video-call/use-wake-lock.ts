"use client";

import { useEffect } from "react";

/**
 * Hold a screen wake lock for the duration of a call so the device doesn't sleep mid-lesson
 * (mobile web, doc §3). Re-acquires when the tab returns to the foreground (the OS drops the lock
 * on hide). No-ops where the Wake Lock API is unavailable.
 */
export function useWakeLock() {
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const request = async () => {
      try {
        if ("wakeLock" in navigator) {
          sentinel = await navigator.wakeLock.request("screen");
        }
      } catch {
        // user-agent may reject (e.g. low battery) — harmless, the call continues.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !released) void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}
