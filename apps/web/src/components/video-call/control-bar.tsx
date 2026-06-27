"use client";

import { useRoomContext, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, MicOff, MonitorUp, PhoneOff, Users, Video, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";

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
 * The in-call control bar: mic · camera · screen-share (desktop) · participants · leave. Built on
 * useTrackToggle so local publish state stays in sync with the SFU; the red leave button
 * disconnects, which the LiveKitRoom wrapper turns into the "left" screen.
 */
export function ControlBar({
  onToggleParticipants,
  participantCount,
}: {
  onToggleParticipants: () => void;
  participantCount: number;
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
