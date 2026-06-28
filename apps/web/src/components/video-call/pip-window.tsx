"use client";

import { useState } from "react";
import {
  VideoTrack,
  isTrackReference,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { MicOff, UserX, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { muteParticipant, muteParticipantVideo, removeParticipant } from "@/lib/api";
import { useCallControl } from "./call-control-context";
import { gridDims } from "./pip-layout";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The content rendered (via a portal) INTO the Document-PiP window: a live, responsive grid of every
 * participant's camera. Because these are real `<video>` elements bound to the LiveKit tracks, they
 * keep decoding while the main tab is backgrounded — no freeze. The host gets per-tile controls
 * (mute mic / remove) that reuse the server-mediated moderation. Lives in the same React tree as the
 * call (portals preserve context), so the LiveKit + i18n hooks work here.
 */
export function PipGrid() {
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const { cols } = gridDims(Math.max(cameras.length, 1));

  return (
    <div
      className="grid h-screen w-screen gap-1 bg-slate-900 p-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}
    >
      {cameras.map((c) => (
        <PipTile key={`${c.participant.identity}:${c.source}`} trackRef={c} />
      ))}
    </div>
  );
}

function PipTile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const t = useTranslations("videoCall");
  const { canManage, roomId, manageToken } = useCallControl();
  const p = trackRef.participant;
  const micOn = p.isMicrophoneEnabled;
  const camOn = p.isCameraEnabled;
  const label = p.name || p.identity;
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  const showControls = canManage && !p.isLocal;
  const [busy, setBusy] = useState<"mute" | "video" | "remove" | null>(null);

  async function act(kind: "mute" | "video" | "remove", fn: () => Promise<unknown>) {
    setBusy(kind);
    try {
      await fn();
    } catch {
      // The roster reflects the authoritative SFU state via events; a failed action just no-ops.
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative min-h-0 overflow-hidden rounded-md bg-slate-800">
      {showVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={`h-full w-full object-cover ${p.isLocal ? "-scale-x-100" : ""}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex size-9 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-slate-200">
            {initials(label)}
          </div>
        </div>
      )}

      {/* Name + mic state along the bottom. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/55 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
        {!micOn && <MicOff className="size-3 shrink-0 text-red-400" />}
        <span className="truncate">{p.isLocal ? t("you") : label}</span>
      </div>

      {/* Host controls — mute the mic / remove, server-mediated. */}
      {showControls && (
        <div className="absolute end-1 top-1 flex gap-1">
          <button
            type="button"
            onClick={() => void act("mute", () => muteParticipant(roomId, p.identity, manageToken))}
            disabled={busy !== null || !micOn}
            aria-label={t("muteParticipant")}
            title={t("muteParticipant")}
            className="flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 disabled:opacity-40"
          >
            <MicOff className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => void act("video", () => muteParticipantVideo(roomId, p.identity, manageToken))}
            disabled={busy !== null || !camOn}
            aria-label={t("stopVideo")}
            title={t("stopVideo")}
            className="flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 disabled:opacity-40"
          >
            <VideoOff className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => void act("remove", () => removeParticipant(roomId, p.identity, manageToken))}
            disabled={busy !== null}
            aria-label={t("removeParticipant")}
            title={t("removeParticipant")}
            className="flex size-6 items-center justify-center rounded-full bg-red-600/80 text-white transition hover:bg-red-600 disabled:opacity-40"
          >
            <UserX className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}
