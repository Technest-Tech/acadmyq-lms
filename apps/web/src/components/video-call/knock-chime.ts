"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Master level of the chime. Deliberately loud — this is an alert, not a UI blip: a teacher who is
 * mid-explanation with a shared screen up has to hear it over their own voice and the call audio.
 */
const PEAK = 0.9;
/** A rising bell arpeggio (C6–E6–G6) — bright enough to cut through speech on laptop speakers. */
const NOTES = [1046.5, 1318.51, 1567.98];
/** Gap between notes, and how long the last one rings on. */
const NOTE_GAP = 0.13;
const RING = 0.3;
const TAIL_RING = 0.6;
/** The arpeggio plays twice ("ding-ding-diiing, ding-ding-diiing") so it reads as a knock. */
const PASSES = 2;

function audioCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

/**
 * One bell strike: a fundamental plus two harmonics with a sharp attack and an exponential decay.
 * Plain sines read as a soft "boop"; the harmonics are what make it carry across a noisy room.
 */
function strike(ctx: AudioContext, out: AudioNode, at: number, freq: number, ring: number) {
  const partials: Array<[mult: number, amp: number, type: OscillatorType]> = [
    [1, 1, "sine"],
    [2, 0.45, "sine"],
    [3.01, 0.2, "triangle"],
  ];
  for (const [mult, amp, type] of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq * mult;
    // exponentialRamp can never touch 0 — ride between near-silence and the partial's peak.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + ring + 0.02);
  }
}

/**
 * The waiting-room knock sound: a loud, Meet-style bell synthesised with the Web Audio API, so it
 * needs no asset and no network fetch at the moment it matters.
 *
 * Two things make it actually audible in practice. The context is built and unlocked up-front (and
 * re-armed on the next user gesture if the browser parked it) rather than at ring time, because a
 * context first created inside a poll callback has no user activation behind it and can come up
 * suspended. And the whole chime runs through a compressor, which lifts the perceived loudness far
 * above what raw gain alone can reach before clipping.
 *
 * Best-effort throughout: where audio is unavailable (no AudioContext, hard autoplay block) the
 * caller's visual panel is the fallback, so every failure here is swallowed.
 */
export function useKnockChime() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const Ctx = audioCtor();
    if (!Ctx) return;
    try {
      ctxRef.current = new Ctx();
    } catch {
      return;
    }
    // If the page had no user activation yet, the context starts suspended and stays silent. Resume
    // it on the first interaction of any kind — after that it survives for the rest of the call.
    const unlock = () => {
      const ctx = ctxRef.current;
      if (ctx && ctx.state === "suspended") void ctx.resume();
    };
    unlock();
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const e of events) document.addEventListener(e, unlock, { passive: true });
    return () => {
      for (const e of events) document.removeEventListener(e, unlock);
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  return useCallback(() => {
    try {
      const ctx = ctxRef.current;
      if (!ctx || ctx.state === "closed") return;
      if (ctx.state === "suspended") void ctx.resume();

      const master = ctx.createGain();
      master.gain.value = PEAK;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      master.connect(comp).connect(ctx.destination);

      const t0 = ctx.currentTime + 0.02;
      const passLen = NOTES.length * NOTE_GAP + 0.22;
      for (let pass = 0; pass < PASSES; pass++) {
        NOTES.forEach((freq, i) => {
          const last = i === NOTES.length - 1;
          strike(ctx, master, t0 + pass * passLen + i * NOTE_GAP, freq, last ? TAIL_RING : RING);
        });
      }
      // Release the per-chime chain once it has rung out.
      setTimeout(() => master.disconnect(), (PASSES * passLen + TAIL_RING + 0.5) * 1000);
    } catch {
      // audio unavailable — the panel is the fallback
    }
  }, []);
}
