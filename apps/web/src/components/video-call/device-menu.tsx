"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaDeviceSelect } from "@livekit/components-react";
import { supportsAudioOutputSelection } from "livekit-client";
import { Mic, MoreHorizontal, Video, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { DevicePicker } from "./device-picker";

/**
 * The control-bar "More" menu: switch the active camera, microphone, and — where the browser supports
 * output selection (Chromium desktop) — the speaker, all WITHOUT leaving the call. Each picker is wired
 * to `useMediaDeviceSelect`, which (inside the LiveKitRoom context) drives `room.switchActiveDevice`:
 * input changes republish the track from the new device; the speaker change re-routes RoomAudioRenderer's
 * sink. Closes on outside-click or Escape. The device hooks live in a child mounted only while open, so
 * we don't enumerate devices for a menu nobody opened.
 */
export function DeviceMenu() {
  const t = useTranslations("videoCall");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("more")}
        title={t("more")}
        className={`flex size-12 items-center justify-center rounded-full transition ${
          open ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/20"
        }`}
      >
        <MoreHorizontal className="size-5" />
      </button>
      {open && <DeviceMenuPanel />}
    </div>
  );
}

/** The popover body — holds the device hooks (active only while the menu is open). */
function DeviceMenuPanel() {
  const t = useTranslations("videoCall");
  const cam = useMediaDeviceSelect({ kind: "videoinput" });
  const mic = useMediaDeviceSelect({ kind: "audioinput" });
  const speaker = useMediaDeviceSelect({ kind: "audiooutput" });
  const canSelectOutput = supportsAudioOutputSelection();

  return (
    <div
      role="menu"
      aria-label={t("devices")}
      className="absolute bottom-full end-0 mb-3 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-slate-800/95 p-3 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur"
    >
      <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {t("devices")}
      </p>
      <div className="space-y-2.5">
        <DevicePicker
          label={t("camera")}
          Icon={Video}
          devices={cam.devices}
          activeId={cam.activeDeviceId}
          onChange={(id) => void cam.setActiveMediaDevice(id)}
        />
        <DevicePicker
          label={t("microphone")}
          Icon={Mic}
          devices={mic.devices}
          activeId={mic.activeDeviceId}
          onChange={(id) => void mic.setActiveMediaDevice(id)}
        />
        {canSelectOutput && (
          <DevicePicker
            label={t("speaker")}
            Icon={Volume2}
            devices={speaker.devices}
            activeId={speaker.activeDeviceId}
            onChange={(id) => void speaker.setActiveMediaDevice(id)}
          />
        )}
      </div>
    </div>
  );
}
