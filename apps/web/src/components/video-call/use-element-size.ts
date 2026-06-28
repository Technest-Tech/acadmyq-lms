"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Track an element's content box size via ResizeObserver — drives the fit-to-area gallery (recomputes
 * the grid on resize / rotation / split-view). SSR- and jsdom-safe: when ResizeObserver is missing it
 * simply reports {0,0} and the caller falls back to its count-based default.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size] as const;
}
