"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { Loader2 } from "lucide-react";
import type { JoinRoomResponse } from "@/lib/api";
import { ControlBar } from "./control-bar";
import { ParticipantTile } from "./participant-tile";

/** A stable key per camera track: participant identity + the publication's track sid (or "cam"). */
function trackKey(ref: TrackReferenceOrPlaceholder): string {
  return `${ref.participant.identity}:${ref.publication?.trackSid ?? "cam"}`;
}

/** Tailwind grid that adapts to the participant count (W3 brings true 1:1 PiP / presenter layouts). */
function gridClass(count: number): string {
  if (count <= 1) return "grid h-full place-items-center";
  if (count === 2) return "grid h-full grid-cols-1 content-center gap-3 sm:grid-cols-2";
  if (count <= 4) return "grid h-full grid-cols-2 content-center gap-3";
  return "grid h-full grid-cols-2 content-center gap-3 lg:grid-cols-3";
}

/**
 * The live call surface. LiveKitRoom owns the connection (connect + auto-publish mic/cam +
 * reconnection); we render custom tiles + a custom control bar on top of its hooks — never the
 * stock <VideoConference/>. RoomAudioRenderer plays remote audio (audio-first, V-AUD-1); the
 * Join user-gesture upstream satisfies mobile autoplay. onDisconnected → the parent's "left" state.
 */
export function CallRoom({
  creds,
  onLeave,
}: {
  creds: JoinRoomResponse;
  onLeave: () => void;
}) {
  return (
    <LiveKitRoom
      serverUrl={creds.url}
      token={creds.token}
      connect
      audio
      video
      onDisconnected={onLeave}
      options={{ adaptiveStream: true, dynacast: true }}
      className="flex h-[100dvh] flex-col bg-slate-900 text-white"
    >
      <CallStage roomTitle={creds.roomTitle} />
      <RoomAudioRenderer />
      <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <ControlBar />
      </div>
    </LiveKitRoom>
  );
}

function CallStage({ roomTitle }: { roomTitle: string }) {
  const state = useConnectionState();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });

  const connecting = state === ConnectionState.Connecting;
  const reconnecting =
    state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;

  return (
    <div className="relative flex-1 overflow-hidden p-3 sm:p-4">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <h1 className="truncate text-sm font-semibold text-white/90">{roomTitle}</h1>
        {reconnecting && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-200 ring-1 ring-amber-400/30">
            <Loader2 className="size-3 animate-spin" />
            Reconnecting…
          </span>
        )}
      </header>

      {connecting && tracks.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-white/70">
          <Loader2 className="size-8 animate-spin text-emerald-400" />
          <p className="text-sm">Connecting…</p>
        </div>
      ) : (
        <div className={gridClass(tracks.length)}>
          {tracks.map((tr) => (
            <ParticipantTile key={trackKey(tr)} trackRef={tr} />
          ))}
        </div>
      )}
    </div>
  );
}
