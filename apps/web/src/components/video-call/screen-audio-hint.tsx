"use client";

import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track, type LocalTrackPublication } from "livekit-client";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";

/**
 * One-per-call nudge the first time this participant publishes screen-share AUDIO. Renders nothing.
 *
 * `restrictOwnAudio` (room-options) removes the echo that mattered — the call being re-captured out
 * of the sharer's own speakers and published back to everyone. What it cannot remove is the purely
 * acoustic path: the clip plays out of the teacher's speakers, their MIC picks it up, and the class
 * now hears the same audio twice — once clean off the screen-audio track and once a beat later
 * through the mic. Echo cancellation fights this and usually wins, but it loses against loud
 * external speakers, and browsers without `restrictOwnAudio` get no protection at all.
 *
 * So: say it once, at the only moment it's actionable, and let them choose. Deliberately not an
 * auto-mute — the teacher is usually narrating over the clip, and silencing them mid-sentence to
 * pre-empt an echo that may not happen trades one support ticket for a worse one.
 */
export function ScreenAudioHint() {
  const room = useRoomContext();
  const toast = useToast();
  const t = useTranslations("videoCall");
  const shown = useRef(false);

  useEffect(() => {
    const onPublished = (pub: LocalTrackPublication) => {
      if (pub.source !== Track.Source.ScreenShareAudio || shown.current) return;
      shown.current = true;
      toast.info(t("screenAudioEchoHint"));
    };
    room.on(RoomEvent.LocalTrackPublished, onPublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, onPublished);
    };
  }, [room, toast, t]);

  return null;
}
