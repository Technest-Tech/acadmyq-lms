"use client";

import { useEffect, useRef } from "react";
import type { LocalAudioTrack } from "livekit-client";

/**
 * A live mic-level meter for the lobby preview. Reads the audio track via the Web Audio API and
 * drives a row of bars directly through refs (no per-frame React re-render) so the lobby stays
 * smooth. Renders nothing measurable when the mic is off (track undefined).
 */
export function MicMeter({ track }: { track: LocalAudioTrack | undefined }) {
  const barsRef = useRef<HTMLDivElement>(null);
  const BARS = 5;

  useEffect(() => {
    const container = barsRef.current;
    const mediaStreamTrack = track?.mediaStreamTrack;
    if (!container || !mediaStreamTrack) return;

    const AudioCtx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = Array.from(container.children) as HTMLElement[];

    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length) / 255;
      smoothed = smoothed * 0.6 + rms * 0.4;
      const active = Math.round(Math.min(1, smoothed * 1.8) * BARS);
      bars.forEach((bar, i) => {
        bar.style.opacity = i < active ? "1" : "0.2";
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [track]);

  return (
    <div ref={barsRef} className="flex items-end gap-0.5" aria-hidden>
      {Array.from({ length: BARS }).map((_, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-emerald-400 opacity-20 transition-opacity"
          style={{ height: `${6 + i * 3}px` }}
        />
      ))}
    </div>
  );
}
