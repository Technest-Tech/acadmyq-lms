import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKnockChime } from "./knock-chime";

/** A minimal Web Audio stub — enough to see what the chime actually schedules. */
function stubAudio(state: AudioContextState = "running") {
  const oscillators: Array<{ freq: number; started: boolean }> = [];
  const resume = vi.fn(() => Promise.resolve());
  const ctx = {
    state,
    currentTime: 0,
    resume,
    close: vi.fn(() => Promise.resolve()),
    destination: { name: "destination" },
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: { value: 0 },
        connect: (n: unknown) => n,
        start: () => {
          rec.started = true;
        },
        stop: vi.fn(),
      };
      const rec = { get freq() { return osc.frequency.value; }, started: false };
      oscillators.push(rec);
      return osc;
    },
    createGain: () => ({
      gain: {
        value: 0,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: (n: unknown) => n,
      disconnect: vi.fn(),
    }),
    createDynamicsCompressor: () => ({
      threshold: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: (n: unknown) => n,
    }),
  };
  // Constructible on purpose — the hook calls `new AudioContext()`, which an arrow fn can't serve.
  vi.stubGlobal(
    "AudioContext",
    function AudioContextStub() {
      return ctx;
    },
  );
  return { ctx, oscillators, resume };
}

afterEach(() => vi.unstubAllGlobals());

describe("useKnockChime", () => {
  it("schedules an audible chime", () => {
    const { oscillators } = stubAudio();
    const { result } = renderHook(() => useKnockChime());

    act(() => result.current());

    // Two passes × three notes × three partials — and every one of them actually starts.
    expect(oscillators).toHaveLength(18);
    expect(oscillators.every((o) => o.started)).toBe(true);
    // The bell is pitched high enough to carry over speech.
    expect(Math.min(...oscillators.map((o) => o.freq))).toBeGreaterThanOrEqual(1000);
  });

  it("resumes a context the browser parked, so the knock is never silent", () => {
    // A context built without user activation comes up suspended; unresumed, it plays nothing.
    const { resume, oscillators } = stubAudio("suspended");
    const { result } = renderHook(() => useKnockChime());

    expect(resume).toHaveBeenCalled(); // unlocked up-front, on mount

    act(() => result.current());

    expect(oscillators.length).toBeGreaterThan(0);
  });

  it("stays silent rather than throwing where Web Audio is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    const { result } = renderHook(() => useKnockChime());

    expect(() => act(() => result.current())).not.toThrow();
  });
});
