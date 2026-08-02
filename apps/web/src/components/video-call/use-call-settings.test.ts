import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("livekit-client", () => ({
  VideoPresets: {
    h720: { resolution: { width: 1280, height: 720 } },
    h360: { resolution: { width: 640, height: 360 } },
  },
}));

import {
  DEFAULT_SETTINGS,
  loadSettings,
  mergeSettings,
  micConstraints,
  micNeedsRestart,
  resolutionConstraints,
  saveSettings,
} from "./use-call-settings";

describe("mergeSettings", () => {
  it("falls back to defaults for junk input", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("nope")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and validates the background union", () => {
    const s = mergeSettings({
      mirror: false,
      resolution: "h720",
      background: { type: "blur", strength: "strong" },
      autoApply: true,
      audioDeviceId: "mic-1",
    });
    expect(s.mirror).toBe(false);
    expect(s.resolution).toBe("h720");
    expect(s.background).toEqual({ type: "blur", strength: "strong" });
    expect(s.autoApply).toBe(true);
    expect(s.audioDeviceId).toBe("mic-1");
  });

  it("rejects an invalid background or resolution", () => {
    expect(mergeSettings({ background: { type: "blur", strength: "nope" } }).background).toEqual({
      type: "none",
    });
    expect(mergeSettings({ background: { type: "image", src: "" } }).background).toEqual({ type: "none" });
    expect(mergeSettings({ resolution: "8k" }).resolution).toBe("auto");
  });
});

describe("defaults", () => {
  it("remembers the setup and isolates voice out of the box", () => {
    // Both are the fix for a real academy report ("I have to set my camera and background every
    // time", "the mic picks up the fan next to me"). Flipping either default back silently restores
    // the bug for every user who never opens the Settings dialog — which is nearly all of them.
    expect(DEFAULT_SETTINGS.autoApply).toBe(true);
    expect(DEFAULT_SETTINGS.voiceIsolation).toBe(true);
  });
});

describe("persistence", () => {
  afterEach(() => window.localStorage.clear());

  it("round-trips through localStorage", () => {
    const s = { ...DEFAULT_SETTINGS, mirror: false, autoApply: true, videoDeviceId: "cam-2" };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it("returns defaults when nothing is saved", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("migrates a v1 blob: keeps the setup, drops v1's autoApply=false", () => {
    window.localStorage.setItem(
      "academiq.callSettings.v1",
      JSON.stringify({
        videoDeviceId: "cam-9",
        background: { type: "blur", strength: "strong" },
        resolution: "h720",
        autoApply: false, // v1's default — the very thing that made the app "forget" the setup
      }),
    );

    const s = loadSettings();
    expect(s.videoDeviceId).toBe("cam-9");
    expect(s.background).toEqual({ type: "blur", strength: "strong" });
    expect(s.resolution).toBe("h720");
    expect(s.autoApply).toBe(true);
    // and it's rewritten under v2 so the migration is paid once
    expect(JSON.parse(window.localStorage.getItem("academiq.callSettings.v2")!).videoDeviceId).toBe(
      "cam-9",
    );
  });

  it("prefers an existing v2 blob over the legacy one, honouring an explicit opt-out", () => {
    window.localStorage.setItem("academiq.callSettings.v1", JSON.stringify({ videoDeviceId: "old" }));
    window.localStorage.setItem(
      "academiq.callSettings.v2",
      JSON.stringify({ videoDeviceId: "new", autoApply: false }),
    );
    const s = loadSettings();
    expect(s.videoDeviceId).toBe("new");
    // Once on v2, a user who turns the switch off keeps it off — the override is migration-only.
    expect(s.autoApply).toBe(false);
  });

  it("survives a corrupt legacy blob", () => {
    window.localStorage.setItem("academiq.callSettings.v1", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("micConstraints", () => {
  it("requests voice isolation alongside noise suppression", () => {
    // Both, deliberately: voiceIsolation supersedes noiseSuppression where supported, and is
    // discarded by browsers that lack it — leaving noiseSuppression as the fallback.
    const c = micConstraints(DEFAULT_SETTINGS);
    expect(c.voiceIsolation).toBe(true);
    expect(c.noiseSuppression).toBe(true);
    expect(c.echoCancellation).toBe(true);
    expect(c.autoGainControl).toBe(true);
  });

  it("passes a chosen device and honours a disabled filter", () => {
    const c = micConstraints({ ...DEFAULT_SETTINGS, audioDeviceId: "mic-3", voiceIsolation: false });
    expect(c.deviceId).toBe("mic-3");
    expect(c.voiceIsolation).toBe(false);
  });

  it("omits deviceId rather than sending an empty string", () => {
    // "" is a valid ConstrainDOMString and would ask for a device literally named "", so the
    // browser could hand back no mic at all instead of the system default.
    expect(micConstraints(DEFAULT_SETTINGS).deviceId).toBeUndefined();
  });
});

describe("micNeedsRestart", () => {
  it("is false for the defaults the join already captured with", () => {
    expect(micNeedsRestart(DEFAULT_SETTINGS)).toBe(false);
  });

  it("is true for a saved device or any disabled filter", () => {
    expect(micNeedsRestart({ ...DEFAULT_SETTINGS, audioDeviceId: "mic-3" })).toBe(true);
    expect(micNeedsRestart({ ...DEFAULT_SETTINGS, voiceIsolation: false })).toBe(true);
    expect(micNeedsRestart({ ...DEFAULT_SETTINGS, noiseSuppression: false })).toBe(true);
    expect(micNeedsRestart({ ...DEFAULT_SETTINGS, echoCancellation: false })).toBe(true);
  });
});

describe("resolutionConstraints", () => {
  it("maps presets, and resolves auto to the 720p capture default", () => {
    expect(resolutionConstraints("h720")).toEqual({ resolution: { width: 1280, height: 720 } });
    expect(resolutionConstraints("h360")).toEqual({ resolution: { width: 640, height: 360 } });
    expect(resolutionConstraints("auto")).toEqual({ resolution: { width: 1280, height: 720 } });
  });

  it("never returns empty constraints", () => {
    // An empty object would make restartTrack() re-acquire the camera with no size constraint —
    // Chrome hands back 640x480 and the call never recovers its 720p. Every mode must carry one.
    for (const r of ["auto", "h720", "h360"] as const) {
      expect(resolutionConstraints(r).resolution).toBeDefined();
    }
  });
});
