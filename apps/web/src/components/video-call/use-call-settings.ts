"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { VideoPresets, type AudioCaptureOptions, type VideoCaptureOptions } from "livekit-client";

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
  /** Browser ML voice isolation — supersedes `noiseSuppression` wherever it's supported. */
  voiceIsolation: boolean;
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
  voiceIsolation: true,
  echoCancellation: true,
  resolution: "auto",
  background: { type: "none" },
  // ON by default. This shipped `false`, with the only way to flip it buried in the Settings dialog
  // footer — so in practice every teacher re-picked their camera and re-chose their background on
  // every single join, and reported it as "the app forgets my setup". Persisting settings nobody
  // ever reads back is just a slow no-op; remembering is the behaviour people expect from Zoom/Meet.
  autoApply: true,
};

const STORAGE_KEY = "academiq.callSettings.v2";
/** v1 stored the same shape but with `autoApply: false` — see `loadSettings` for why that migrates. */
const LEGACY_STORAGE_KEY = "academiq.callSettings.v1";

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
    voiceIsolation:
      typeof p.voiceIsolation === "boolean" ? p.voiceIsolation : DEFAULT_SETTINGS.voiceIsolation,
    echoCancellation:
      typeof p.echoCancellation === "boolean" ? p.echoCancellation : DEFAULT_SETTINGS.echoCancellation,
    resolution:
      p.resolution === "h720" || p.resolution === "h360" || p.resolution === "auto"
        ? p.resolution
        : "auto",
    background: normalizeBackground(p.background),
    autoApply: typeof p.autoApply === "boolean" ? p.autoApply : DEFAULT_SETTINGS.autoApply,
  };
}

export function loadSettings(): CallSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeSettings(JSON.parse(raw));

    // v1 → v2. Carry the saved devices / background / resolution forward, but deliberately DROP the
    // stored `autoApply` and take the v2 default instead: v1 wrote `false` for everyone as its
    // default, so honouring it would faithfully migrate the very bug this change fixes. The toggle
    // is still in the dialog for anyone who genuinely wants a clean slate each call.
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(legacy);
    const migrated = mergeSettings(
      parsed && typeof parsed === "object"
        ? { ...parsed, autoApply: DEFAULT_SETTINGS.autoApply }
        : parsed,
    );
    saveSettings(migrated);
    return migrated;
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

/**
 * Capture constraints for a chosen resolution — never empty, not even for "auto".
 *
 * These feed `LocalVideoTrack.restartTrack()`, and an empty object there does NOT mean "keep the
 * current capture format". `LocalTrack.restart()` rebuilds getUserMedia from `{deviceId, facingMode}`
 * alone and hands everything else to `applyConstraints()`, then overwrites the track's stored
 * constraints with what it was given — so `{}` re-acquires the camera with no size constraint at all
 * (Chrome falls back to 640x480) and the 720p the call joined with is gone for the rest of the
 * session, along with the simulcast ladder that was sized for it. "auto" therefore resolves to the
 * same 720p ideal LiveKit captures with at join (`videoCaptureDefaults`), which keeps switching
 * camera mid-call quality-neutral. These are `ideal` constraints, so a webcam that can't do 720p
 * still negotiates its best mode.
 */
export function resolutionConstraints(resolution: VideoResolution): VideoCaptureOptions {
  if (resolution === "h360") return { resolution: VideoPresets.h360.resolution };
  return { resolution: VideoPresets.h720.resolution }; // "h720" | "auto"
}

/**
 * Mic capture constraints for the current settings — shared by every path that opens or restarts the
 * microphone (lobby preview, apply-on-join, the live Settings dialog) so the three can never drift.
 *
 * `voiceIsolation` is the real lever behind "the mic picks up the fan next to me". Plain
 * `noiseSuppression` is the classic stationary-noise suppressor: it takes the edge off steady
 * broadband hum but leaves plenty of it, and it has no notion of "is this a voice" — so a fan, a
 * sibling in the next room, or street noise all ride through into the class. `voiceIsolation` is the
 * browser's ML speech extractor and is dramatically better at exactly that.
 *
 * Sending BOTH is correct, not contradictory: per spec voiceIsolation overrides noiseSuppression
 * where it's supported, and where it isn't the constraint name is simply discarded by the UA and
 * noiseSuppression still applies. So this degrades cleanly on Safari/Firefox instead of throwing.
 * Both are plain (non-`exact`) booleans, i.e. *ideal* constraints — an unsupported one can never
 * produce an OverconstrainedError and kill the mic.
 */
export function micConstraints(s: CallSettings): AudioCaptureOptions {
  return {
    deviceId: s.audioDeviceId || undefined,
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    voiceIsolation: s.voiceIsolation,
    autoGainControl: true,
  };
}

/**
 * Whether these settings differ from what `CLASSROOM_ROOM_OPTIONS.audioCaptureDefaults` already
 * captured with at join. The join-time defaults are the "everything on" case, so only a saved device
 * or a deliberately-disabled filter needs a restart — and a restart costs a fresh getUserMedia plus
 * an audible gap, which is not worth paying on every single join for a no-op.
 */
export function micNeedsRestart(s: CallSettings): boolean {
  return !!s.audioDeviceId || !s.noiseSuppression || !s.echoCancellation || !s.voiceIsolation;
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
