"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
} from "@livekit/components-react";
import type {
  AudioCaptureOptions,
  DisconnectReason,
  VideoCaptureOptions,
} from "livekit-client";
import type { JoinRoomResponse } from "@/lib/api";
import { ApplySettingsOnJoin } from "./apply-settings-on-join";
import { CallControlContext } from "./call-control-context";
import { CallMain } from "./call-main";
import { CallTimerProvider } from "./call-timer-context";
import { ChatPanel } from "./chat-panel";
import { ChatProvider } from "./chat-context";
import { CompositePipProvider } from "./composite-pip";
import { ControlBar } from "./control-bar";
import type { LobbySettings } from "./lobby";
import { MediaErrorToast } from "./media-error-toast";
import { MonitorFrame } from "./monitor-frame";
import { ParticipantsPanel } from "./participants-panel";
import { PinContext, nextPinned } from "./pin-context";
import { PresenterBubble } from "./presenter-bubble";
import { PresenterShell } from "./presenter-panel";
import { RecordingProvider } from "./recording-context";
import { CLASSROOM_ROOM_OPTIONS } from "./room-options";
import { ScreenAudioHint } from "./screen-audio-hint";
import { SettingsDialog } from "./settings-dialog";
import { usePresenterMode } from "./use-presenter-mode";
import { WhiteboardProvider } from "./whiteboard-context";
import {
  CallSettingsContext,
  useProvideCallSettings,
} from "./use-call-settings";
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
      options={CLASSROOM_ROOM_OPTIONS}
      className="flex h-[100dvh] flex-col bg-slate-900 text-white"
    >
      <InCall
        roomTitle={creds.roomTitle}
        canManage={creds.canManage}
        roomId={creds.roomId}
        manageToken={creds.manageToken ?? null}
        suppressRecording={creds.suppressRecordingIndicator ?? false}
        isMonitor={creds.role === "monitor"}
      />
    </LiveKitRoom>
  );
}

/** Inside the room context: stage + audio + participants drawer + control bar, with a wake lock. */
function InCall({
  roomTitle,
  canManage,
  roomId,
  manageToken,
  suppressRecording,
  isMonitor,
}: {
  roomTitle: string;
  canManage: boolean;
  roomId: string;
  manageToken: string | null;
  suppressRecording: boolean;
  isMonitor: boolean;
}) {
  useWakeLock();
  const participants = useParticipants();
  // Desktop app only: when this host starts screen-sharing, reshape the window into the floating
  // presenter panel (and restore on stop). `presenter` drives the compact layout in CallMain.
  const presenter = usePresenterMode(canManage);
  const settingsCtx = useProvideCallSettings();
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  // Presenter-panel collapse (desktop): shrink the floating window into a small bubble and back.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!presenter && collapsed) setCollapsed(false); // share stopped → always reopen
  }, [presenter, collapsed]);
  const collapsePanel = useCallback(() => {
    setCollapsed(true);
    window.academiqDesktop?.collapsePresenter?.();
  }, []);
  const expandPanel = useCallback(() => {
    setCollapsed(false);
    window.academiqDesktop?.expandPresenter?.();
  }, []);

  // A local pin/spotlight, shared with the stage + tiles + panel. Drop it if the pinned person leaves.
  useEffect(() => {
    if (pinnedId && !participants.some((p) => p.identity === pinnedId))
      setPinnedId(null);
  }, [pinnedId, participants]);

  const togglePin = useCallback((identity: string) => {
    setPinnedId((prev) => nextPinned(prev, identity));
  }, []);
  const pin = useMemo(
    () => ({ pinnedId, togglePin, isPinned: (id: string) => id === pinnedId }),
    [pinnedId, togglePin],
  );
  const control = useMemo(
    () => ({ canManage, roomId, manageToken }),
    [canManage, roomId, manageToken],
  );

  return (
    <CallSettingsContext.Provider value={settingsCtx}>
      <CallControlContext.Provider value={control}>
        <PinContext.Provider value={pin}>
          <CompositePipProvider>
            <ChatProvider>
              <RecordingProvider>
                <WhiteboardProvider>
                  {/* Above the stage⇄whiteboard swap so the call timer survives the board opening. */}
                  <CallTimerProvider>
                    <ApplySettingsOnJoin />
                    <MediaErrorToast />
                    <ScreenAudioHint />
                    {isMonitor && <MonitorFrame />}
                    {presenter ? (
                      // Desktop screen-share: the modern floating presenter card (or its collapsed
                      // bubble). The normal stage + control bar are replaced entirely.
                      collapsed ? (
                        <PresenterBubble onExpand={expandPanel} />
                      ) : (
                        <PresenterShell
                          onCollapse={collapsePanel}
                          participantCount={participants.length}
                          onToggleParticipants={() => setPanelOpen((v) => !v)}
                        />
                      )
                    ) : (
                      <>
                        <CallMain roomTitle={roomTitle} suppressRecording={suppressRecording} />
                        <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
                          <ControlBar
                            onToggleParticipants={() => setPanelOpen((v) => !v)}
                            onToggleSettings={() => setSettingsOpen((v) => !v)}
                            participantCount={participants.length}
                            canManage={canManage}
                          />
                        </div>
                      </>
                    )}
                    <RoomAudioRenderer />
                    <ParticipantsPanel
                      open={panelOpen}
                      onClose={() => setPanelOpen(false)}
                      canManage={canManage}
                      roomId={roomId}
                      manageToken={manageToken}
                    />
                    <SettingsDialog
                      open={settingsOpen}
                      onClose={() => setSettingsOpen(false)}
                    />
                    {/* While presenting, chat is docked inside the presenter card (PresenterShell),
                        so the full-window drawer would just overlay the tiny panel — suppress it. */}
                    {!presenter && <ChatPanel />}
                  </CallTimerProvider>
                </WhiteboardProvider>
              </RecordingProvider>
            </ChatProvider>
          </CompositePipProvider>
        </PinContext.Provider>
      </CallControlContext.Provider>
    </CallSettingsContext.Provider>
  );
}
