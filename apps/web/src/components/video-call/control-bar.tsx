"use client";

import { useRoomContext, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Eraser,
  Loader2,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  Minimize2,
  MonitorUp,
  Pencil,
  PhoneOff,
  PictureInPicture2,
  Presentation,
  Settings,
  Square,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { ChatButton } from "./chat-button";
import { usePip } from "./composite-pip";
import { useRecording } from "./recording-context";
import { useWhiteboard } from "./whiteboard-context";
import { useFullscreen } from "./use-fullscreen";
import { useIsDesktop } from "./use-is-desktop";
import { useEffect, useRef, useState } from "react";

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
  compact = false,
}: {
  on: boolean;
  pending?: boolean;
  onClick: () => void;
  OnIcon: LucideIcon;
  OffIcon: LucideIcon;
  label: string;
  className?: string;
  activeStyle?: string;
  /** Smaller footprint for the floating presenter panel. */
  compact?: boolean;
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
      className={`flex ${compact ? "size-10" : "size-12"} items-center justify-center rounded-full transition disabled:opacity-50 ${
        on ? activeStyle : "bg-red-500/90 text-white hover:bg-red-500"
      } ${className}`}
    >
      <Icon className={compact ? "size-[18px]" : "size-5"} />
    </button>
  );
}

/** Host-only whiteboard toggle — opens/closes the shared board for everyone (whiteboard-context). */
function WhiteboardButton({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("videoCall");
  const { open, toggleBoard } = useWhiteboard();
  return (
    <button
      type="button"
      onClick={toggleBoard}
      aria-pressed={open}
      aria-label={t("whiteboard")}
      title={t("whiteboard")}
      className={`flex ${compact ? "size-10" : "size-12"} items-center justify-center rounded-full transition ${
        open ? "bg-emerald-500/90 text-white hover:bg-emerald-500" : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      <Presentation className={compact ? "size-[18px]" : "size-5"} />
    </button>
  );
}

/**
 * Annotate-the-shared-screen toggle — shown only to a host running the DESKTOP app. Arming makes the
 * screen-share picker screens-only, shows the overlay on the shared display, and lets students draw
 * (canDraw); a sibling clear button wipes the marks. In a plain browser this renders nothing, so the
 * web control bar is unchanged (V-DESK-3). Marks bake into the shared screen via the desktop overlay.
 */
function AnnotateButton({ compact = false }: { compact?: boolean }) {
  const isDesktop = useIsDesktop();
  const { canManage, setAllowDraw, clearScreenAnnotations, setScreenBaking } = useWhiteboard();
  const [on, setOn] = useState(false);
  const onRef = useRef(on);
  onRef.current = on;

  // The floating toolbar's Clear/Close buttons reach us over the bridge: "clear" wipes the marks,
  // "off" (the toolbar's red X) flips this toggle off and tears down the draw permission + baking flag.
  useEffect(() => {
    const desktop = typeof window !== "undefined" ? window.academiqDesktop : undefined;
    if (!desktop?.onAnnotateControl) return;
    return desktop.onAnnotateControl((command) => {
      if (command === "clear") {
        clearScreenAnnotations();
      } else if (command === "off" && onRef.current) {
        setOn(false);
        setAllowDraw(false);
        setScreenBaking(false);
        // The desktop side already disarmed the overlay (armAnnotate(false)); no setAnnotateMode here.
      }
    });
  }, [clearScreenAnnotations, setAllowDraw, setScreenBaking]);

  if (!isDesktop || !canManage) return null;

  const toggle = () => {
    const next = !on;
    setOn(next);
    setAllowDraw(next); // let students draw on the share while annotation is on
    setScreenBaking(next); // tell viewers the overlay bakes marks → they stop double-rendering them
    window.academiqDesktop?.setAnnotateMode?.(next);
  };

  const sz = compact ? "size-10" : "size-12";
  const icon = compact ? "size-[18px]" : "size-5";
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        aria-label="Annotate shared screen"
        title="Annotate shared screen"
        className={`flex ${sz} items-center justify-center rounded-full transition ${
          on ? "bg-emerald-500/90 text-white hover:bg-emerald-500" : "bg-white/10 text-white hover:bg-white/20"
        }`}
      >
        <Pencil className={icon} />
      </button>
      {/* In the compact presenter bar the floating toolbar already carries Clear, so skip it here. */}
      {on && !compact && (
        <button
          type="button"
          onClick={clearScreenAnnotations}
          aria-label="Clear annotations"
          title="Clear annotations"
          className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <Eraser className="size-5" />
        </button>
      )}
    </>
  );
}

/**
 * Host-only record toggle, driven by the shared recording lifecycle (recording-context). Reflects
 * the SERVER recording state (correct even if another host toggled it) and shows a pending spinner
 * through the `starting`/`stopping` windows until egress actually flips — the context fires the
 * "started" / "saved" toasts off the real signal, so this button is purely presentational.
 */
function RecordButton({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("videoCall");
  const { phase, isRecording, busy, toggle } = useRecording();
  const active = isRecording || phase === "stopping";
  const label =
    phase === "starting"
      ? t("recordingStarting")
      : phase === "stopping"
        ? t("recordingStopping")
        : active
          ? t("stopRecording")
          : t("startRecording");

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex ${compact ? "size-10" : "size-12"} items-center justify-center rounded-full transition disabled:opacity-60 ${
        active ? "bg-red-500/90 text-white hover:bg-red-500" : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {busy ? (
        <Loader2 className={`${compact ? "size-[18px]" : "size-5"} animate-spin`} />
      ) : active ? (
        <Square className={`${compact ? "size-3.5" : "size-4"} fill-current`} />
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
  onToggleSettings,
  participantCount,
  canManage,
  presenter = false,
  onCollapse,
}: {
  onToggleParticipants: () => void;
  onToggleSettings: () => void;
  participantCount: number;
  /** Host with room.manage → show the record toggle (driven by recording-context). */
  canManage: boolean;
  /** Compact, single-row layout for the small floating presenter panel (desktop screen-share). */
  presenter?: boolean;
  /** Presenter only: collapse the panel into a bubble. */
  onCollapse?: () => void;
}) {
  const t = useTranslations("videoCall");
  const room = useRoomContext();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    // Request system/tab audio with the share so the picker shows "Share audio".
    captureOptions: { audio: true },
  });
  const fs = useFullscreen();
  const pip = usePip();

  // Compact presenter bar: a single tidy row of just the controls a teacher needs while sharing —
  // mic · camera · stop-share · annotate · record · participants · collapse · leave. The rest
  // (fullscreen/PiP/whiteboard/chat/settings) stay in the full bar shown when not presenting.
  if (presenter) {
    return (
      <div className="mx-auto flex w-full max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-slate-800/90 px-2 py-1.5 ring-1 ring-white/10 backdrop-blur">
        <ToggleButton
          compact
          on={mic.enabled}
          pending={mic.pending}
          onClick={() => void mic.toggle()}
          OnIcon={Mic}
          OffIcon={MicOff}
          label={mic.enabled ? t("muteMic") : t("unmuteMic")}
        />
        <ToggleButton
          compact
          on={cam.enabled}
          pending={cam.pending}
          onClick={() => void cam.toggle()}
          OnIcon={Video}
          OffIcon={VideoOff}
          label={cam.enabled ? t("turnCameraOff") : t("turnCameraOn")}
        />
        <button
          type="button"
          onClick={() => void screen.toggle()}
          disabled={screen.pending}
          aria-pressed={screen.enabled}
          aria-label={screen.enabled ? t("stopShareScreen") : t("shareScreen")}
          title={screen.enabled ? t("stopShareScreen") : t("shareScreen")}
          className={`flex size-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50 ${
            screen.enabled ? "bg-emerald-500/90 text-white hover:bg-emerald-500" : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          <MonitorUp className="size-[18px]" />
        </button>
        <AnnotateButton compact />
        {canManage && <WhiteboardButton compact />}
        {canManage && <RecordButton compact />}
        <button
          type="button"
          onClick={onToggleParticipants}
          aria-label={t("participants")}
          title={t("participants")}
          className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <Users className="size-[18px]" />
          <span className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[0.6rem] font-bold text-white">
            {participantCount}
          </span>
        </button>
        <ChatButton compact />
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t("collapsePanel")}
            title={t("collapsePanel")}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <Minimize2 className="size-[18px]" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void room.disconnect()}
          aria-label={t("leave")}
          title={t("leave")}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700"
        >
          <PhoneOff className="size-[18px]" />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-fit max-w-[calc(100vw-1rem)] flex-wrap items-center justify-center gap-2 rounded-3xl bg-slate-800/80 px-3 py-2.5 ring-1 ring-white/10 backdrop-blur sm:gap-3 sm:rounded-full sm:px-4">
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
      {/* Fullscreen — desktop only; hidden where the element Fullscreen API is unavailable (iOS). */}
      {fs.supported && (
        <button
          type="button"
          onClick={() => void fs.toggle()}
          aria-pressed={fs.isFullscreen}
          aria-label={fs.isFullscreen ? t("exitFullscreen") : t("enterFullscreen")}
          title={fs.isFullscreen ? t("exitFullscreen") : t("enterFullscreen")}
          className="hidden size-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:flex"
        >
          {fs.isFullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
        </button>
      )}
      {/* Picture-in-picture — a floating window of ALL participants; desktop only, support-gated. */}
      {pip.supported && (
        <button
          type="button"
          onClick={pip.toggle}
          aria-pressed={pip.isActive}
          aria-label={pip.isActive ? t("exitPictureInPicture") : t("pictureInPicture")}
          title={pip.isActive ? t("exitPictureInPicture") : t("pictureInPicture")}
          className={`hidden size-12 items-center justify-center rounded-full transition sm:flex ${
            pip.isActive
              ? "bg-emerald-500/90 text-white hover:bg-emerald-500"
              : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          <PictureInPicture2 className="size-5" />
        </button>
      )}
      {canManage && <WhiteboardButton />}
      <AnnotateButton />
      {canManage && <RecordButton />}
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
      <ChatButton />
      <button
        type="button"
        onClick={onToggleSettings}
        aria-label={t("settings")}
        title={t("settings")}
        className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <Settings className="size-5" />
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
