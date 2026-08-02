"use client";

import { useEffect, useRef } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import {
  ConnectionState,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "livekit-client";
import { applyBackground } from "./background-processor";
import {
  micConstraints,
  micNeedsRestart,
  resolutionConstraints,
  useSettings,
} from "./use-call-settings";

/**
 * When "apply automatically" is on (the default), re-apply the saved devices / mic processing /
 * resolution / background to the local tracks, so the call starts already in the user's setup.
 * Renders nothing.
 *
 * Keyed per PUBLICATION rather than run once, which fixes two real failures of the old
 * "fire once on Connected" version:
 *
 *  1. It raced the first publish. `ConnectionState.Connected` says the signal link is up, not that
 *     the camera track exists yet — and since the guard latched immediately, losing that race
 *     silently dropped the ENTIRE restore (background included) for the rest of the call. That is
 *     the intermittent half of "it forgets my background": same settings, different outcome per join
 *     depending on how fast the camera opened.
 *  2. Toggling the camera off and on mid-call builds a NEW LocalVideoTrack, and a processor does not
 *     survive that — so the background silently fell off and never came back. Comparing `trackSid`
 *     means each fresh track gets the background re-applied, while a `restartTrack` (which keeps the
 *     same sid) doesn't re-trigger us and can't loop.
 */
export function ApplySettingsOnJoin() {
  const room = useRoomContext();
  const { microphoneTrack, cameraTrack } = useLocalParticipant();
  const { settings, hydrated } = useSettings();
  // The publication each setting was last applied to — null until applied, then that track's sid.
  const micApplied = useRef<string | null>(null);
  const camApplied = useRef<string | null>(null);
  const outputApplied = useRef(false);

  useEffect(() => {
    if (!hydrated || !settings.autoApply) return;
    if (room.state !== ConnectionState.Connected) return;

    void (async () => {
      try {
        const mic = microphoneTrack?.track as LocalAudioTrack | undefined;
        if (mic && microphoneTrack && micApplied.current !== microphoneTrack.trackSid) {
          micApplied.current = microphoneTrack.trackSid;
          // The join already captured with the "everything on" defaults, so only a saved device or a
          // deliberately-disabled filter is worth the restart's audible gap.
          if (micNeedsRestart(settings)) {
            await mic.restartTrack(micConstraints(settings)).catch(() => {});
          }
        }

        const cam = cameraTrack?.track as LocalVideoTrack | undefined;
        if (cam && cameraTrack && camApplied.current !== cameraTrack.trackSid) {
          camApplied.current = cameraTrack.trackSid;
          if (settings.videoDeviceId || settings.resolution !== "auto") {
            await cam
              .restartTrack({
                deviceId: settings.videoDeviceId || undefined,
                ...resolutionConstraints(settings.resolution),
              })
              .catch(() => {});
          }
          // Always re-assert the background — including "none", so a track inheriting a stale
          // processor from a previous camera is cleared rather than left blurred.
          await applyBackground(cam, settings.background).catch(() => {});
        }

        if (settings.audioOutputId && !outputApplied.current) {
          outputApplied.current = true;
          await room.switchActiveDevice("audiooutput", settings.audioOutputId).catch(() => {});
        }
      } catch {
        // best-effort; the call still works with the joined defaults
      }
    })();
  }, [room, room.state, microphoneTrack, cameraTrack, settings, hydrated]);

  return null;
}
