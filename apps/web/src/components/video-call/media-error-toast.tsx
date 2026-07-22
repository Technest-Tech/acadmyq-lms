"use client";

import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import { MediaDeviceFailure, RoomEvent } from "livekit-client";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";

/**
 * Surfaces local capture failures IN-CALL. The control bar toggles mic/camera through
 * useTrackToggle, whose rejected getUserMedia is swallowed (`void mic.toggle()`), so a teacher
 * whose browser has the mic/camera blocked — or whose device is held by another app — clicks the
 * button, nothing happens, and there's no hint why (the lobby classifies these errors, but only for
 * the preview; in-call there was no feedback at all). LiveKit fires RoomEvent.MediaDevicesError on
 * every such failure; we classify it (permission / in-use / not-found) and raise a specific,
 * actionable toast telling them how to fix it. Renders nothing. Throttled per (failure×device) so a
 * retry loop shows one toast, not a stack.
 */
export function MediaErrorToast() {
  const room = useRoomContext();
  const toast = useToast();
  const t = useTranslations("videoCall");
  const lastShown = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const handle = (error: Error, kind?: MediaDeviceKind) => {
      const failure = MediaDeviceFailure.getFailure(error);
      const key = `${failure ?? "other"}|${kind ?? "?"}`;
      const now = Date.now();
      if (now - (lastShown.current.get(key) ?? 0) < 4000) return; // throttle bursts
      lastShown.current.set(key, now);

      const device =
        kind === "videoinput"
          ? t("deviceCam")
          : kind === "audioinput"
            ? t("deviceMic")
            : t("deviceMedia");

      const message =
        failure === MediaDeviceFailure.PermissionDenied
          ? t("mediaBlocked", { device })
          : failure === MediaDeviceFailure.DeviceInUse
            ? t("mediaInUse", { device })
            : failure === MediaDeviceFailure.NotFound
              ? t("mediaNotFound", { device })
              : t("mediaFailed", { device });

      toast.error(message);
    };

    room.on(RoomEvent.MediaDevicesError, handle);
    return () => {
      room.off(RoomEvent.MediaDevicesError, handle);
    };
  }, [room, toast, t]);

  return null;
}
