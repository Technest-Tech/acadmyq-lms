"use client";

import { useRoomContext, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** A round mic/camera toggle. Muted state is red-tinted; large enough for touch (≥44px). */
function ToggleButton({
  on,
  pending,
  onClick,
  OnIcon,
  OffIcon,
  label,
}: {
  on: boolean;
  pending: boolean;
  onClick: () => void;
  OnIcon: LucideIcon;
  OffIcon: LucideIcon;
  label: string;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={on}
      aria-label={label}
      className={`flex size-12 items-center justify-center rounded-full transition disabled:opacity-50 ${
        on
          ? "bg-white/10 text-white hover:bg-white/20"
          : "bg-red-500/90 text-white hover:bg-red-500"
      }`}
    >
      <Icon className="size-5" />
    </button>
  );
}

/**
 * The in-call control bar (W2 — mic · camera · leave). Built on useTrackToggle so the local
 * publish state stays in sync with the SFU; the red leave button disconnects the room, which the
 * LiveKitRoom wrapper turns into the "left" screen. Screen-share / participants / more land in W3.
 */
export function ControlBar() {
  const room = useRoomContext();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });

  return (
    <div className="mx-auto flex w-fit items-center gap-3 rounded-full bg-slate-800/80 px-4 py-3 ring-1 ring-white/10 backdrop-blur">
      <ToggleButton
        on={mic.enabled}
        pending={mic.pending}
        onClick={() => void mic.toggle()}
        OnIcon={Mic}
        OffIcon={MicOff}
        label="Toggle microphone"
      />
      <ToggleButton
        on={cam.enabled}
        pending={cam.pending}
        onClick={() => void cam.toggle()}
        OnIcon={Video}
        OffIcon={VideoOff}
        label="Toggle camera"
      />
      <button
        type="button"
        onClick={() => void room.disconnect()}
        aria-label="Leave call"
        className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-5 font-medium text-white transition hover:bg-red-700"
      >
        <PhoneOff className="size-5" />
        <span className="hidden sm:inline">Leave</span>
      </button>
    </div>
  );
}
