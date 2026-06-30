"use client";

import { useEffect, useRef } from "react";
import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useIsDesktop } from "./use-is-desktop";

/**
 * Presenter ("screen-share") mode for the desktop app. When the local host starts sharing their
 * screen, we tell the desktop shell to reshape the call window into a small, content-protected
 * floating panel (`enterPresenter`) so the teacher can use their PC while sharing; when sharing
 * stops, we restore it (`exitPresenter`). The returned boolean drives the web's compact presenter
 * layout in that same window.
 *
 * - Detection is on the actual published **local screen-share track**, via `useTracks` — so it reacts
 *   to the OS "Stop sharing" bar (track unpublished), not just the in-app button.
 * - Gated on `useIsDesktop()` AND host (`canManage`): in a browser, or for a non-host, `active` is
 *   always false and no bridge call ever fires (V-DESK-3 — byte-identical web behavior).
 * - The unmount cleanup fires `exitPresenter` so leaving the call while sharing also restores the
 *   window and clears the annotation overlay (the desktop side treats exit as the overlay cleanup too).
 */
export function usePresenterMode(canManage: boolean): boolean {
  const isDesktop = useIsDesktop();
  const screens = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  });
  const active = isDesktop && canManage && screens.some((s) => s.participant.isLocal);

  const enteredRef = useRef(false);

  useEffect(() => {
    if (active && !enteredRef.current) {
      enteredRef.current = true;
      window.academiqDesktop?.enterPresenter?.();
    } else if (!active && enteredRef.current) {
      enteredRef.current = false;
      window.academiqDesktop?.exitPresenter?.();
    }
  }, [active]);

  useEffect(
    () => () => {
      if (enteredRef.current) {
        enteredRef.current = false;
        window.academiqDesktop?.exitPresenter?.();
      }
    },
    [],
  );

  return active;
}
