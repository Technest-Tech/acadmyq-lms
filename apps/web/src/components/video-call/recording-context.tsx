"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsRecording } from "@livekit/components-react";
import { useTranslations } from "next-intl";
import { ApiError, startRoomRecording, stopRoomRecording } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useCallControl } from "./call-control-context";
import { RecordingSavedDialog } from "./recording-saved-dialog";

/**
 * idle → starting → recording → stopping → idle. `starting`/`stopping` are the optimistic windows
 * between the host's click and the SFU's egress actually flipping on/off (a few seconds each way);
 * `recording` mirrors the SERVER signal so every host stays in sync even if another one toggled it.
 */
export type RecordingPhase = "idle" | "starting" | "recording" | "stopping";

interface RecordingValue {
  phase: RecordingPhase;
  /** Server truth — an egress is live. Drives the everyone-sees REC badge (consent visibility). */
  isRecording: boolean;
  /** A transition is in flight (starting or stopping) — disable the toggle, show a spinner. */
  busy: boolean;
  /** Start if idle, stop if recording; no-op mid-transition. */
  toggle: () => void;
}

const RecordingContext = createContext<RecordingValue | null>(null);

// The egress signal never flipped (e.g. it failed to spin up / tear down) — release the optimistic
// phase back to whatever the server actually reports so the UI never gets stuck on a spinner.
const SETTLE_TIMEOUT = 15000;

/**
 * Owns the on-demand recording lifecycle for a host and surfaces accurate, professional feedback at
 * each transition: a toast when egress truly starts ("Recording started") and when it truly stops
 * and the file is saved ("Recording saved"), driven by the LiveKit `isRecording` signal rather than
 * the API round-trip (the file finalises asynchronously). Non-host participants get the same context
 * but only ever observe `isRecording` for the consent badge — they never call `toggle`.
 */
export function RecordingProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("videoCall");
  const toast = useToast();
  const { roomId, manageToken } = useCallControl();
  const serverRecording = useIsRecording();

  const [phase, setPhase] = useState<RecordingPhase>(serverRecording ? "recording" : "idle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const serverRef = useRef(serverRecording);
  serverRef.current = serverRecording;
  const prevServer = useRef(serverRecording);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Shown to the host who stopped once the file is truly finalised (a confirmation they can dismiss).
  const [savedOpen, setSavedOpen] = useState(false);

  const clearSettle = useCallback(() => {
    if (settle.current) {
      clearTimeout(settle.current);
      settle.current = null;
    }
  }, []);

  // The SFU recording signal is the source of truth for "actually started" / "actually saved".
  useEffect(() => {
    if (serverRecording === prevServer.current) return;
    prevServer.current = serverRecording;
    clearSettle();
    if (serverRecording) {
      if (phaseRef.current === "starting") toast.success(t("recordingStarted"));
      setPhase("recording");
    } else {
      // Egress stopped → the file has been finalised to the academy's recordings. Confirm with a
      // dismissible modal (clearer than a toast) — only for the host who actually stopped it.
      if (phaseRef.current === "stopping") setSavedOpen(true);
      setPhase("idle");
    }
  }, [serverRecording, clearSettle, t, toast]);

  useEffect(() => clearSettle, [clearSettle]);

  const armSettle = useCallback(() => {
    clearSettle();
    settle.current = setTimeout(() => {
      // Egress never flipped — fall back to whatever the server currently reports.
      setPhase(serverRef.current ? "recording" : "idle");
    }, SETTLE_TIMEOUT);
  }, [clearSettle]);

  const toggle = useCallback(() => {
    const now = phaseRef.current;
    if (now === "starting" || now === "stopping") return;

    if (now === "recording") {
      setPhase("stopping");
      toast.info(t("recordingStopping"));
      armSettle();
      stopRoomRecording(roomId, manageToken).catch(() => {
        clearSettle();
        setPhase("recording");
        toast.error(t("recordingStopFailed"));
      });
      return;
    }

    setPhase("starting");
    toast.info(t("recordingStarting"));
    armSettle();
    startRoomRecording(roomId, manageToken).catch((e) => {
      clearSettle();
      setPhase("idle");
      if (e instanceof ApiError && e.status === 403) toast.error(t("recordingDisabled"));
      else toast.error(t("recordingStartFailed"));
    });
  }, [roomId, manageToken, armSettle, clearSettle, t, toast]);

  return (
    <RecordingContext.Provider
      value={{
        phase,
        isRecording: serverRecording,
        busy: phase === "starting" || phase === "stopping",
        toggle,
      }}
    >
      {children}
      <RecordingSavedDialog open={savedOpen} onClose={() => setSavedOpen(false)} />
    </RecordingContext.Provider>
  );
}

export function useRecording(): RecordingValue {
  const ctx = useContext(RecordingContext);
  if (ctx === null) {
    throw new Error("useRecording must be used within a RecordingProvider");
  }
  return ctx;
}
