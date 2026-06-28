"use client";

import { useEffect, useRef } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import {
  ConnectionState,
  Track,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "livekit-client";
import { applyBackground } from "./background-processor";
import { resolutionConstraints, useSettings } from "./use-call-settings";

/**
 * When "apply automatically" is on, re-apply the saved devices / mic-processing / resolution to the
 * local tracks once, right after the room connects — so the call starts already in the user's setup.
 * Renders nothing. (Restarts are guarded so a default config doesn't flicker the tracks.)
 */
export function ApplySettingsOnJoin() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { settings, hydrated } = useSettings();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !hydrated || !settings.autoApply) return;
    if (room.state !== ConnectionState.Connected) return;
    done.current = true;

    void (async () => {
      try {
        const mic = localParticipant.getTrackPublication(Track.Source.Microphone)?.track as
          | LocalAudioTrack
          | undefined;
        if (mic && (settings.audioDeviceId || !settings.noiseSuppression || !settings.echoCancellation)) {
          await mic
            .restartTrack({
              deviceId: settings.audioDeviceId || undefined,
              noiseSuppression: settings.noiseSuppression,
              echoCancellation: settings.echoCancellation,
            })
            .catch(() => {});
        }
        const cam = localParticipant.getTrackPublication(Track.Source.Camera)?.track as
          | LocalVideoTrack
          | undefined;
        if (cam && (settings.videoDeviceId || settings.resolution !== "auto")) {
          await cam
            .restartTrack({
              deviceId: settings.videoDeviceId || undefined,
              ...resolutionConstraints(settings.resolution),
            })
            .catch(() => {});
        }
        if (cam && settings.background.type !== "none") {
          await applyBackground(cam, settings.background).catch(() => {});
        }
        if (settings.audioOutputId) {
          await room.switchActiveDevice("audiooutput", settings.audioOutputId).catch(() => {});
        }
      } catch {
        // best-effort; the call still works with the joined defaults
      }
    })();
  }, [room, room.state, localParticipant, settings, hydrated]);

  return null;
}
