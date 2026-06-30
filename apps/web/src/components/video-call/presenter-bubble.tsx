"use client";

import {
  VideoTrack,
  isTrackReference,
  useParticipants,
  useSpeakingParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Maximize2, MicOff } from "lucide-react";
import { useTranslations } from "next-intl";

/** Electron drag region — move the frameless bubble by dragging it (the expand button is no-drag). */
const DRAG = { WebkitAppRegion: "drag" } as unknown as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as unknown as React.CSSProperties;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The collapsed presenter UI — a small, modern, draggable video bubble (Zoom-style) that fills the
 * shrunk floating window while the teacher screen-shares. It shows the active speaker's camera (or the
 * first participant) so the teacher keeps a glance at the room, with a live count and a one-tap expand
 * back to the full panel. Desktop-only; content-protected window.
 */
export function PresenterBubble({ onExpand }: { onExpand: () => void }) {
  const t = useTranslations("videoCall");
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });

  // Prefer the teacher's OWN camera so they get a self-view while collapsed; fall back to the active
  // speaker (then any remote, then whatever's there) when their camera is off.
  const local = cameras.find((c) => c.participant.isLocal);
  const localLive = local && isTrackReference(local) && !local.publication.isMuted;
  const remotes = cameras.filter((c) => !c.participant.isLocal);
  const focus = localLive
    ? local
    : (remotes.find((r) => speaking.some((s) => s.identity === r.participant.identity)) ??
      remotes[0] ??
      local ??
      cameras[0]);

  const p = focus?.participant;
  const showVideo = focus && isTrackReference(focus) && !focus.publication.isMuted;
  const label = p ? p.name || p.identity : "";

  return (
    <div
      style={DRAG}
      className="group relative size-full overflow-hidden bg-slate-900"
    >
      {showVideo ? (
        <VideoTrack
          trackRef={focus}
          className={`size-full object-cover ${p?.isLocal ? "-scale-x-100" : ""}`}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-slate-700 text-base font-semibold text-slate-200">
            {label ? initials(label) : "•"}
          </span>
        </div>
      )}

      {/* Top: live status + expand */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-1.5">
        <span className="pointer-events-none flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.6rem] font-bold text-white backdrop-blur">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          {participants.length}
        </span>
        <button
          type="button"
          style={NO_DRAG}
          onClick={onExpand}
          aria-label={t("expandPanel")}
          title={t("expandPanel")}
          className="pointer-events-auto flex size-7 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur transition hover:bg-black/75"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>

      {/* Bottom: name + mic state */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[0.65rem] font-medium text-white">
        {p && !p.isMicrophoneEnabled && <MicOff className="size-3 shrink-0 text-red-400" />}
        <span className="truncate">{p?.isLocal ? t("you") : label}</span>
      </div>
    </div>
  );
}
