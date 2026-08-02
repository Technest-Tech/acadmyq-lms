import { describe, expect, it, vi } from "vitest";

vi.mock("livekit-client", () => ({
  ScreenSharePresets: { h720fps15: { width: 1280, height: 720, encoding: {} } },
  VideoPreset: class {
    constructor(
      public width: number,
      public height: number,
      public maxBitrate: number,
      public maxFramerate: number,
    ) {}
  },
}));

import { CLASSROOM_ROOM_OPTIONS, SCREEN_SHARE_CAPTURE_OPTIONS } from "./room-options";

describe("audioCaptureDefaults", () => {
  it("isolates voice for every participant at join, not just those who open Settings", () => {
    // A student will never find the Settings dialog, and the loudest complaint about the classroom
    // is the OTHER side's background noise — so the join default is the only place this can live.
    expect(CLASSROOM_ROOM_OPTIONS.audioCaptureDefaults).toMatchObject({
      voiceIsolation: true,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    });
  });
});

describe("SCREEN_SHARE_CAPTURE_OPTIONS", () => {
  it("restricts own audio whenever system audio can be captured", () => {
    // systemAudio:"include" captures everything the machine plays — INCLUDING the call itself out of
    // the sharer's speakers, which re-published the whole class back to itself as an echo.
    // restrictOwnAudio is what breaks that loop; the two must never be separated.
    expect(SCREEN_SHARE_CAPTURE_OPTIONS.systemAudio).toBe("include");
    expect(SCREEN_SHARE_CAPTURE_OPTIONS.audio).toMatchObject({ restrictOwnAudio: true });
  });

  it("still requests share audio at all", () => {
    // Regression guard: an object is truthy, but swapping it for `audio: false` or dropping the key
    // would silently kill sound-sharing entirely rather than just the echo protection.
    expect(SCREEN_SHARE_CAPTURE_OPTIONS.audio).toBeTruthy();
  });

  it("does not suppress local playback — the teacher narrates over the clip they can hear", () => {
    expect(SCREEN_SHARE_CAPTURE_OPTIONS.suppressLocalAudioPlayback).toBeUndefined();
  });
});
