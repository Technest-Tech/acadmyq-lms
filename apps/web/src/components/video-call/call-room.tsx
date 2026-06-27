"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer, useParticipants } from "@livekit/components-react";
import type { AudioCaptureOptions, DisconnectReason, VideoCaptureOptions } from "livekit-client";
import type { JoinRoomResponse } from "@/lib/api";
import { CallStage } from "./call-stage";
import { ControlBar } from "./control-bar";
import type { LobbySettings } from "./lobby";
import { ParticipantsPanel } from "./participants-panel";
import { PinContext, nextPinned } from "./pin-context";
import { useWakeLock } from "./use-wake-lock";

/**
 * The live call surface. LiveKitRoom owns the connection (connect + initial publish + reconnection)
 * with the lobby's device + on/off choices; we render custom tiles + a custom control bar on its
 * hooks — never the stock <VideoConference/>. RoomAudioRenderer plays remote audio (audio-first,
 * V-AUD-1); the Join user-gesture upstream satisfies mobile autoplay. onDisconnected → "left".
 */
export function CallRoom({
  creds,
  settings,
  onLeave,
}: {
  creds: JoinRoomResponse;
  settings: LobbySettings;
  onLeave: (reason?: DisconnectReason) => void;
}) {
  const audio: AudioCaptureOptions | boolean = settings.micEnabled
    ? settings.audioDeviceId
      ? { deviceId: settings.audioDeviceId }
      : true
    : false;
  const video: VideoCaptureOptions | boolean = settings.camEnabled
    ? settings.videoDeviceId
      ? { deviceId: settings.videoDeviceId }
      : true
    : false;

  return (
    <LiveKitRoom
      serverUrl={creds.url}
      token={creds.token}
      connect
      audio={audio}
      video={video}
      onDisconnected={(reason) => onLeave(reason)}
      options={{ adaptiveStream: true, dynacast: true }}
      className="flex h-[100dvh] flex-col bg-slate-900 text-white"
    >
      <InCall roomTitle={creds.roomTitle} canManage={creds.canManage} roomId={creds.roomId} />
    </LiveKitRoom>
  );
}

/** Inside the room context: stage + audio + participants drawer + control bar, with a wake lock. */
function InCall({
  roomTitle,
  canManage,
  roomId,
}: {
  roomTitle: string;
  canManage: boolean;
  roomId: string;
}) {
  useWakeLock();
  const participants = useParticipants();
  const [panelOpen, setPanelOpen] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  // A local pin/spotlight, shared with the stage + tiles + panel. Drop it if the pinned person leaves.
  useEffect(() => {
    if (pinnedId && !participants.some((p) => p.identity === pinnedId)) setPinnedId(null);
  }, [pinnedId, participants]);

  const togglePin = useCallback((identity: string) => {
    setPinnedId((prev) => nextPinned(prev, identity));
  }, []);
  const pin = useMemo(
    () => ({ pinnedId, togglePin, isPinned: (id: string) => id === pinnedId }),
    [pinnedId, togglePin],
  );

  return (
    <PinContext.Provider value={pin}>
      <CallStage roomTitle={roomTitle} />
      <RoomAudioRenderer />
      <ParticipantsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        canManage={canManage}
        roomId={roomId}
      />
      <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <ControlBar
          onToggleParticipants={() => setPanelOpen((v) => !v)}
          participantCount={participants.length}
          canManage={canManage}
          roomId={roomId}
        />
      </div>
    </PinContext.Provider>
  );
}
