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
  // The host asked to stop and we're waiting for egress to actually finalise. Drives the saved modal
  // and suppresses a late/flapping "active" signal so the button can't flash red before it saves.
  const stopIntent = useRef(false);

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
      // While a stop is pending, ignore a late/flapping "active" — otherwise the button flashes back
      // to the red "recording" state for a moment right before the file finishes saving.
      if (!stopIntent.current) setPhase("recording");
    } else {
      // Egress stopped → the file has been finalised to the academy's recordings. Confirm with a
      // dismissible modal (clearer than a toast) to the host who asked to stop — robust even if the
      // phase was knocked off "stopping" (e.g. a lost stop response).
      if (stopIntent.current || phaseRef.current === "stopping") setSavedOpen(true);
      stopIntent.current = false;
      setPhase("idle");
    }
  }, [serverRecording, clearSettle, t, toast]);

  useEffect(() => clearSettle, [clearSettle]);

  // Egress never flipped within the grace window → fall back to the server truth. A stuck STOP is a
  // genuine failure worth reporting (still recording); a stuck start just settles quietly.
  const armSettle = useCallback(
    (intent: "start" | "stop") => {
      clearSettle();
      settle.current = setTimeout(() => {
        stopIntent.current = false;
        if (serverRef.current) {
          setPhase("recording");
          if (intent === "stop") toast.error(t("recordingStopFailed"));
        } else {
          setPhase("idle");
        }
      }, SETTLE_TIMEOUT);
    },
    [clearSettle, t, toast],
  );

  const toggle = useCallback(() => {
    const now = phaseRef.current;
    if (now === "starting" || now === "stopping") return;

    if (now === "recording") {
      stopIntent.current = true;
      setPhase("stopping");
      toast.info(t("recordingStopping"));
      armSettle("stop");
      // Deliberately no state change on a rejected request: the egress usually stops even when this
      // HTTP response is lost, so flipping back to "recording" would just flash the button red. The
      // SFU signal shows the saved modal; the settle fallback recovers a genuinely stuck stop.
      stopRoomRecording(roomId, manageToken).catch(() => undefined);
      return;
    }

    stopIntent.current = false;
    setPhase("starting");
    toast.info(t("recordingStarting"));
    armSettle("start");
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
