"use client";

import {
  VideoTrack,
  isTrackReference,
  useIsSpeaking,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { MicOff, MonitorUp } from "lucide-react";

/** Up to two initials from a display name (falls back to a placeholder glyph). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * One participant (or a screen-share) rendered as a custom tile on the @livekit/components-react
 * primitives — never the stock conference UI. Camera tiles get a speaking ring + mic-off badge and
 * are mirrored only for the local self-view; a screen-share is letterboxed (object-contain) with a
 * "presenting" badge. `fill` makes it occupy its parent (spotlight focus / presenter screen).
 */
export function ParticipantTile({
  trackRef,
  fill = false,
  youLabel = "you",
}: {
  trackRef: TrackReferenceOrPlaceholder;
  fill?: boolean;
  youLabel?: string;
}) {
  const participant = trackRef.participant;
  const speaking = useIsSpeaking(participant);
  const micOn = participant.isMicrophoneEnabled;
  const label = participant.name || participant.identity;
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  const isLocal = participant.isLocal;
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl bg-slate-800 ring-1 transition-shadow duration-200 ${
        speaking && !isScreen ? "ring-2 ring-emerald-400" : "ring-white/10"
      } ${fill ? "size-full" : "aspect-video min-h-0 w-full"}`}
    >
      {showVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={`size-full ${isScreen ? "bg-black object-contain" : "object-cover"} ${
            isLocal && !isScreen ? "-scale-x-100" : ""
          }`}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-slate-700 text-xl font-semibold text-slate-200 sm:size-20 sm:text-2xl">
            {initials(label)}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
        {isScreen ? (
          <MonitorUp className="size-4 shrink-0 text-emerald-300" />
        ) : (
          !micOn && (
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-500/90">
              <MicOff className="size-3 text-white" />
            </span>
          )
        )}
        <span className="truncate text-sm font-medium text-white">
          {label}
          {isLocal && !isScreen && <span className="ms-1 text-white/60">({youLabel})</span>}
        </span>
      </div>
    </div>
  );
}
