"use client";

import { useState } from "react";
import { LiveKitRoom, RoomAudioRenderer, useParticipants } from "@livekit/components-react";
import type { AudioCaptureOptions, VideoCaptureOptions } from "livekit-client";
import type { JoinRoomResponse } from "@/lib/api";
import { CallStage } from "./call-stage";
import { ControlBar } from "./control-bar";
import type { LobbySettings } from "./lobby";
import { ParticipantsPanel } from "./participants-panel";
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
  onLeave: () => void;
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
      onDisconnected={onLeave}
      options={{ adaptiveStream: true, dynacast: true }}
      className="flex h-[100dvh] flex-col bg-slate-900 text-white"
    >
      <InCall roomTitle={creds.roomTitle} />
    </LiveKitRoom>
  );
}

/** Inside the room context: stage + audio + participants drawer + control bar, with a wake lock. */
function InCall({ roomTitle }: { roomTitle: string }) {
  useWakeLock();
  const participants = useParticipants();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <CallStage roomTitle={roomTitle} />
      <RoomAudioRenderer />
      <ParticipantsPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
      <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <ControlBar
          onToggleParticipants={() => setPanelOpen((v) => !v)}
          participantCount={participants.length}
        />
      </div>
    </>
  );
}
