"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";

/** Wall-clock ms when the meeting first reached Connected, or null before then. */
const CallStartContext = createContext<number | null>(null);

/**
 * Captures the meeting start (the first time the room reaches Connected) ONCE and holds it for the
 * whole session. It is mounted ABOVE the stage⇄whiteboard swap, so the elapsed clock keeps counting
 * from the real start even though <CallStage> (and its timer) unmounts while the board is open —
 * opening the whiteboard no longer resets it. A brief reconnect doesn't reset it either (start is
 * sticky once set).
 */
export function CallTimerProvider({ children }: { children: ReactNode }) {
  const state = useConnectionState();
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (state === ConnectionState.Connected) {
      setStartedAt((cur) => (cur === null ? Date.now() : cur));
    }
  }, [state]);

  return (
    <CallStartContext.Provider value={startedAt}>
      {children}
    </CallStartContext.Provider>
  );
}

/** Elapsed whole seconds since the meeting started, ticking every second; null until connected. */
export function useCallElapsed(): number | null {
  const startedAt = useContext(CallStartContext);
  const [elapsed, setElapsed] = useState<number | null>(() =>
    startedAt === null ? null : Math.floor((Date.now() - startedAt) / 1000),
  );

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(null);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

/** `mm:ss`, or `h:mm:ss` once the call passes an hour. */
export function formatElapsed(totalSeconds: number): string {
  const s = String(totalSeconds % 60).padStart(2, "0");
  const m = String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0");
  const h = Math.floor(totalSeconds / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}
