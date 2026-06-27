"use client";

import { useState } from "react";
import {
  VideoTrack,
  isTrackReference,
  useIsSpeaking,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Loader2, Mic, MicOff, MonitorUp, Pin, PinOff, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { muteParticipant, removeParticipant } from "@/lib/api";
import { useCallControl } from "./call-control-context";
import { usePin } from "./pin-context";

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
  const t = useTranslations("videoCall");
  const { isPinned, togglePin } = usePin();
  const { canManage, roomId } = useCallControl();
  const participant = trackRef.participant;
  const speaking = useIsSpeaking(participant);
  const micOn = participant.isMicrophoneEnabled;
  const label = participant.name || participant.identity;
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  const isLocal = participant.isLocal;
  const pinned = isPinned(participant.identity);
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;

  // Host moderation, inline on the tile (server-mediated) — lives in the bottom bar with the pin so it
  // never collides with the stage header, on every tile incl. the 1:1 focus.
  const showHostControls = canManage && !isLocal && !isScreen;
  const [busy, setBusy] = useState<"mute" | "remove" | null>(null);

  async function act(kind: "mute" | "remove", fn: () => Promise<unknown>) {
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
    <div
      // Tag camera tiles so the composite-PiP can sample this already-decoding <video> (no 2nd decode).
      data-pip-id={isScreen ? undefined : participant.identity}
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
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
          {label}
          {isLocal && !isScreen && <span className="ms-1 text-white/60">({youLabel})</span>}
        </span>
        {/* Host moderation — force-mute (only while their mic is live) + remove, server-mediated. */}
        {showHostControls && micOn && (
          <button
            type="button"
            onClick={() => void act("mute", () => muteParticipant(roomId, participant.identity))}
            disabled={busy !== null}
            aria-label={t("muteParticipant")}
            title={t("muteParticipant")}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white disabled:opacity-50"
          >
            {busy === "mute" ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
          </button>
        )}
        {showHostControls && (
          <button
            type="button"
            onClick={() => void act("remove", () => removeParticipant(roomId, participant.identity))}
            disabled={busy !== null}
            aria-label={t("removeParticipant")}
            title={t("removeParticipant")}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-red-500/80 hover:text-white disabled:opacity-50"
          >
            {busy === "remove" ? <Loader2 className="size-3.5 animate-spin" /> : <UserX className="size-3.5" />}
          </button>
        )}
        {/* Pin/spotlight this participant locally (not screen-shares — those auto-present). */}
        {!isScreen && (
          <button
            type="button"
            onClick={() => togglePin(participant.identity)}
            aria-pressed={pinned}
            aria-label={pinned ? t("unpin") : t("pin")}
            title={pinned ? t("unpin") : t("pin")}
            className={`flex size-7 shrink-0 items-center justify-center rounded-full transition ${
              pinned
                ? "bg-emerald-500/90 text-white"
                : "bg-white/10 text-white/80 opacity-80 hover:bg-white/20 hover:text-white hover:opacity-100"
            }`}
          >
            {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
