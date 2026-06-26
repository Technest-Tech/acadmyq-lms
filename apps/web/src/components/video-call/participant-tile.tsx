"use client";

import {
  VideoTrack,
  isTrackReference,
  useIsSpeaking,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { MicOff } from "lucide-react";

/** Up to two initials from a display name (falls back to a placeholder glyph). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * One participant rendered as a custom tile (W2 — functional; W3 brings the premium polish):
 * their camera if publishing, otherwise an initials avatar. A speaking ring and a mic-off badge
 * give the minimum in-call feedback. Built on the @livekit/components-react primitives, never the
 * stock conference UI.
 */
export function ParticipantTile({
  trackRef,
}: {
  trackRef: TrackReferenceOrPlaceholder;
}) {
  const participant = trackRef.participant;
  const speaking = useIsSpeaking(participant);
  const micOn = participant.isMicrophoneEnabled;
  const label = participant.name || participant.identity;
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;

  return (
    <div
      className={`relative aspect-video min-h-0 w-full overflow-hidden rounded-2xl bg-slate-800 ring-1 transition-shadow duration-200 ${
        speaking ? "ring-2 ring-emerald-400" : "ring-white/10"
      }`}
    >
      {showVideo ? (
        <VideoTrack trackRef={trackRef} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center">
          <span className="flex size-20 items-center justify-center rounded-full bg-slate-700 text-2xl font-semibold text-slate-200">
            {initials(label)}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
        {!micOn && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-500/90">
            <MicOff className="size-3 text-white" />
          </span>
        )}
        <span className="truncate text-sm font-medium text-white">
          {label}
          {participant.isLocal && <span className="ms-1 text-white/60">(you)</span>}
        </span>
      </div>
    </div>
  );
}
