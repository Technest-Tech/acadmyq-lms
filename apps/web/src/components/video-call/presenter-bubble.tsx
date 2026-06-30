"use client";

import {
  VideoTrack,
  isTrackReference,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Maximize2, MicOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { gridDims } from "./pip-layout";

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
 * The collapsed presenter UI — a small, modern, draggable mini-grid (Zoom-style) that fills the shrunk
 * floating window while the teacher screen-shares. It shows EVERY participant's camera (the teacher's
 * own self-view + each student) so the teacher keeps a glance at the whole room, with a live count and
 * a one-tap expand back to the full panel. Desktop-only; content-protected window.
 */
export function PresenterBubble({ onExpand }: { onExpand: () => void }) {
  const t = useTranslations("videoCall");
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  // Local first, so the teacher's self-view leads the grid.
  const ordered = [...cameras].sort(
    (a, b) => Number(b.participant.isLocal) - Number(a.participant.isLocal),
  );
  const { cols } = gridDims(Math.max(ordered.length, 1));

  return (
    <div style={DRAG} className="group relative size-full overflow-hidden bg-slate-900">
      <div
        className="grid size-full gap-px"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}
      >
        {ordered.map((c) => (
          <MiniTile key={`${c.participant.identity}:${c.source}`} trackRef={c} youLabel={t("you")} />
        ))}
      </div>

      {/* Live count (top-left) + expand (top-right) */}
      <span className="pointer-events-none absolute start-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.6rem] font-bold text-white backdrop-blur">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
        {cameras.length}
      </span>
      <button
        type="button"
        style={NO_DRAG}
        onClick={onExpand}
        aria-label={t("expandPanel")}
        title={t("expandPanel")}
        className="absolute end-1.5 top-1.5 flex size-7 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur transition hover:bg-black/75"
      >
        <Maximize2 className="size-3.5" />
      </button>
    </div>
  );
}

function MiniTile({
  trackRef,
  youLabel,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  youLabel: string;
}) {
  const p = trackRef.participant;
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  const label = p.name || p.identity;

  return (
    <div className="relative min-h-0 overflow-hidden bg-slate-800">
      {showVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={`size-full object-cover ${p.isLocal ? "-scale-x-100" : ""}`}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
            {initials(label)}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-0.5 text-[0.6rem] font-medium text-white">
        {!p.isMicrophoneEnabled && <MicOff className="size-2.5 shrink-0 text-red-400" />}
        <span className="truncate">{p.isLocal ? youLabel : label}</span>
      </div>
    </div>
  );
}
