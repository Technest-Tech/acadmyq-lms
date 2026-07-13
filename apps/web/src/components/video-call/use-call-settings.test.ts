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
