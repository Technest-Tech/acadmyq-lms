"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { VideoPresets, type VideoCaptureOptions } from "livekit-client";

export type VideoResolution = "auto" | "h720" | "h360";

/** The background effect. Kept a discriminated union so persistence + the picker stay type-safe. */
export type CallBackground =
  | { type: "none" }
  | { type: "blur"; strength: "light" | "strong" }
  | { type: "image"; src: string };

export interface CallSettings {
  audioDeviceId: string;
  videoDeviceId: string;
  audioOutputId: string;
  /** Mirror the local self-view only (never affects what others see). */
  mirror: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  resolution: VideoResolution;
  background: CallBackground;
  /** Re-apply these settings automatically the next time a room starts. */
  autoApply: boolean;
}

export const DEFAULT_SETTINGS: CallSettings = {
  audioDeviceId: "",
  videoDeviceId: "",
  audioOutputId: "",
  mirror: true,
  noiseSuppression: true,
  echoCancellation: true,
  resolution: "auto",
  background: { type: "none" },
  autoApply: false,
};

const STORAGE_KEY = "academiq.callSettings.v1";

function normalizeBackground(bg: unknown): CallBackground {
  if (bg && typeof bg === "object") {
    const b = bg as { type?: unknown; strength?: unknown; src?: unknown };
    if (b.type === "blur" && (b.strength === "light" || b.strength === "strong")) {
      return { type: "blur", strength: b.strength };
    }
    if (b.type === "image" && typeof b.src === "string" && b.src) {
      return { type: "image", src: b.src };
    }
  }
  return { type: "none" };
}

/** Merge an untrusted (e.g. persisted) value onto the defaults, validating the discriminated union. */
export function mergeSettings(partial: unknown): CallSettings {
  if (!partial || typeof partial !== "object") return { ...DEFAULT_SETTINGS };
  const p = partial as Partial<CallSettings>;
  return {
    audioDeviceId: typeof p.audioDeviceId === "string" ? p.audioDeviceId : "",
    videoDeviceId: typeof p.videoDeviceId === "string" ? p.videoDeviceId : "",
    audioOutputId: typeof p.audioOutputId === "string" ? p.audioOutputId : "",
    mirror: typeof p.mirror === "boolean" ? p.mirror : DEFAULT_SETTINGS.mirror,
    noiseSuppression:
      typeof p.noiseSuppression === "boolean" ? p.noiseSuppression : DEFAULT_SETTINGS.noiseSuppression,
    echoCancellation:
      typeof p.echoCancellation === "boolean" ? p.echoCancellation : DEFAULT_SETTINGS.echoCancellation,
    resolution:
      p.resolution === "h720" || p.resolution === "h360" || p.resolution === "auto"
        ? p.resolution
        : "auto",
    background: normalizeBackground(p.background),
    autoApply: typeof p.autoApply === "boolean" ? p.autoApply : false,
  };
}

export function loadSettings(): CallSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? mergeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: CallSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // private mode / quota — ignore; settings still apply for this session
  }
}

/** Capture constraints for a chosen resolution ("auto" imposes none). */
export function resolutionConstraints(resolution: VideoResolution): VideoCaptureOptions {
  if (resolution === "h720") return { resolution: VideoPresets.h720.resolution };
  if (resolution === "h360") return { resolution: VideoPresets.h360.resolution };
  return {};
}

export interface CallSettingsContextValue {
  settings: CallSettings;
  update: (patch: Partial<CallSettings>) => void;
  hydrated: boolean;
}

export const CallSettingsContext = createContext<CallSettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
  hydrated: false,
});

export function useSettings(): CallSettingsContextValue {
  return useContext(CallSettingsContext);
}

/**
 * Owns the live call-settings state, hydrated from localStorage after mount (so SSR markup matches),
 * and persisted on every change so "apply automatically" can re-use them on the next join.
 */
export function useProvideCallSettings(): CallSettingsContextValue {
  const [settings, setSettings] = useState<CallSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<CallSettings>) => {
    setSettings((prev) => {
      const next = mergeSettings({ ...prev, ...patch });
      saveSettings(next);
      return next;
    });
  }, []);

  return { settings, update, hydrated };
}
