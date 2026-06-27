"use client";

import { createContext, useContext } from "react";

/**
 * A LOCAL, per-viewer "pin" (a.k.a. spotlight): the identity this browser has chosen to keep as the
 * big focus, overriding the automatic active-speaker / grid choice. It is NOT broadcast to other
 * participants — each viewer pins for themselves (the Zoom/Meet "pin" model). Provided by the in-call
 * surface and consumed by the stage (to focus), the tiles, and the participants panel (to toggle).
 */
export interface PinContextValue {
  pinnedId: string | null;
  togglePin: (identity: string) => void;
  isPinned: (identity: string) => boolean;
}

export const PinContext = createContext<PinContextValue>({
  pinnedId: null,
  togglePin: () => {},
  isPinned: () => false,
});

export function usePin(): PinContextValue {
  return useContext(PinContext);
}

/** Pure toggle: pin a fresh identity, or unpin if it's already the pinned one. */
export function nextPinned(current: string | null, identity: string): string | null {
  return current === identity ? null : identity;
}
