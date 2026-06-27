"use client";

import { useEffect, useRef, useState } from "react";
import { useIsRecording, useRoomContext, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Loader2, Mic, MicOff, MonitorUp, PhoneOff, Square, Users, Video, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { startRoomRecording, stopRoomRecording } from "@/lib/api";
import { DeviceMenu } from "./device-menu";

/** A round mic/camera/screen toggle. Muted/inactive state is red/neutral; ≥44px touch target. */
function ToggleButton({
  on,
  pending,
  onClick,
  OnIcon,
  OffIcon,
  label,
  className = "",
  activeStyle = "bg-white/10 text-white hover:bg-white/20",
}: {
  on: boolean;
  pending?: boolean;
  onClick: () => void;
  OnIcon: LucideIcon;
  OffIcon: LucideIcon;
  label: string;
  className?: string;
  activeStyle?: string;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`flex size-12 items-center justify-center rounded-full transition disabled:opacity-50 ${
        on ? activeStyle : "bg-red-500/90 text-white hover:bg-red-500"
      } ${className}`}
    >
      <Icon className="size-5" />
    </button>
  );
}

/**
 * Host-only record toggle. Reflects the SERVER recording state via useIsRecording (so it's correct
 * even if another host toggled it), and shows a pending spinner from the click until the SFU's
 * recording state actually flips — egress takes a few seconds to spin up its compositor. A safety
 * timeout clears the spinner if the state never changes (e.g. egress failed to start).
 */
function RecordButton({ roomId }: { roomId: string }) {
  const t = useTranslations("videoCall");
  const isRecording = useIsRecording();
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The server state caught up to our action → stop showing pending.
  useEffect(() => {
    setPending(false);
    if (timer.current) clearTimeout(timer.current);
  }, [isRecording]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function toggle() {
    if (pending) return;
    setPending(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPending(false), 12000); // egress didn't flip — release the UI
    try {
      if (isRecording) await stopRoomRecording(roomId);
      else await startRoomRecording(roomId);
    } catch {
      setPending(false);
      if (timer.current) clearTimeout(timer.current);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={pending}
      aria-pressed={isRecording}
      aria-label={isRecording ? t("stopRecording") : t("startRecording")}
      title={isRecording ? t("stopRecording") : t("startRecording")}
      className={`flex size-12 items-center justify-center rounded-full transition disabled:opacity-60 ${
        isRecording ? "bg-red-500/90 text-white hover:bg-red-500" : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {pending ? (
        <Loader2 className="size-5 animate-spin" />
      ) : isRecording ? (
        <Square className="size-4 fill-current" />
      ) : (
        <span className="size-3.5 rounded-full bg-red-500" />
      )}
    </button>
  );
}

/**
 * The in-call control bar: mic · camera · screen-share (desktop) · participants · leave. Built on
 * useTrackToggle so local publish state stays in sync with the SFU; the red leave button
 * disconnects, which the LiveKitRoom wrapper turns into the "left" screen.
 */
export function ControlBar({
  onToggleParticipants,
  participantCount,
  canManage,
  roomId,
}: {
  onToggleParticipants: () => void;
  participantCount: number;
  /** Host with room.manage → show the record toggle. */
  canManage: boolean;
  /** Room UUID the record toggle drives. */
  roomId: string;
}) {
  const t = useTranslations("videoCall");
  const room = useRoomContext();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare });

  return (
    <div className="mx-auto flex w-fit items-center gap-2.5 rounded-full bg-slate-800/80 px-3 py-2.5 ring-1 ring-white/10 backdrop-blur sm:gap-3 sm:px-4">
      <ToggleButton
        on={mic.enabled}
        pending={mic.pending}
        onClick={() => void mic.toggle()}
        OnIcon={Mic}
        OffIcon={MicOff}
        label={mic.enabled ? t("muteMic") : t("unmuteMic")}
      />
      <ToggleButton
        on={cam.enabled}
        pending={cam.pending}
        onClick={() => void cam.toggle()}
        OnIcon={Video}
        OffIcon={VideoOff}
        label={cam.enabled ? t("turnCameraOff") : t("turnCameraOn")}
      />
      {/* Screen share — desktop only (getDisplayMedia is unsupported on most mobile browsers). */}
      <button
        type="button"
        onClick={() => void screen.toggle()}
        disabled={screen.pending}
        aria-pressed={screen.enabled}
        aria-label={screen.enabled ? t("stopShareScreen") : t("shareScreen")}
        title={screen.enabled ? t("stopShareScreen") : t("shareScreen")}
        className={`hidden size-12 items-center justify-center rounded-full transition disabled:opacity-50 sm:flex ${
          screen.enabled
            ? "bg-emerald-500/90 text-white hover:bg-emerald-500"
            : "bg-white/10 text-white hover:bg-white/20"
        }`}
      >
        <MonitorUp className="size-5" />
      </button>
      {canManage && <RecordButton roomId={roomId} />}
      <button
        type="button"
        onClick={onToggleParticipants}
        aria-label={t("participants")}
        title={t("participants")}
        className="relative flex size-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <Users className="size-5" />
        <span className="absolute -end-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[0.65rem] font-bold text-white">
          {participantCount}
        </span>
      </button>
      <DeviceMenu />
      <button
        type="button"
        onClick={() => void room.disconnect()}
        aria-label={t("leave")}
        className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-5 font-medium text-white transition hover:bg-red-700"
      >
        <PhoneOff className="size-5" />
        <span className="hidden sm:inline">{t("leave")}</span>
      </button>
    </div>
  );
}
