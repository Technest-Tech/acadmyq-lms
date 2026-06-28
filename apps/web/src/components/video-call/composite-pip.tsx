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
import { createPortal } from "react-dom";
import { useParticipants, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { documentPipSupported, openPipWindow } from "./document-pip";
import { coverCrop, pipCells } from "./pip-layout";
import { PipGrid } from "./pip-window";

interface PipValue {
  supported: boolean;
  isActive: boolean;
  toggle: () => void;
}

const PipContext = createContext<PipValue>({ supported: false, isActive: false, toggle: () => {} });

export function usePip(): PipValue {
  return useContext(PipContext);
}

const CANVAS_W = 480;
const CANVAS_H = 360;
const FPS = 12;
const PIP_W = 420;
const PIP_H = 320;

interface SceneItem {
  id: string;
  label: string;
  muted: boolean;
  isLocal: boolean;
}

/**
 * A floating "all participants" window (Zoom-style) so you can see AND hear the room while working in
 * another tab/app. Two backends:
 *
 * 1. **Document Picture-in-Picture** (Chromium 116+, preferred) — a real window we portal LIVE `<video>`
 *    tiles + host controls into. The videos are bound to the LiveKit tracks, so they keep decoding while
 *    the opener tab is backgrounded (no freeze), the host can mute/remove inline, and it scales to many
 *    participants via a responsive CSS grid.
 * 2. **Canvas → native PiP** (fallback for Safari/Firefox/older) — a hidden canvas composites every
 *    camera (sampled from the stage tiles tagged `data-pip-id`) at ~12fps into a captured <video>.
 *    Caveat: a fully-hidden tab throttles the canvas redraw, so video gets choppy in deep background.
 */
export function CompositePipProvider({ children }: { children: ReactNode }) {
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  useParticipants(); // re-render on mic/identity changes so the scene + overlays stay fresh

  const [isActive, setIsActive] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const docPip = documentPipSupported();
  const nativePip = typeof document !== "undefined" && !!document.pictureInPictureEnabled;
  const supported = docPip || nativePip;

  // Canvas-fallback machinery (unused on the Document-PiP path).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sceneRef = useRef<SceneItem[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Refresh the scene each render (cheap); the draw loop reads the ref.
  sceneRef.current = cameras.map((c) => ({
    id: c.participant.identity,
    label: c.participant.name || c.participant.identity,
    muted: !c.participant.isMicrophoneEnabled,
    isLocal: c.participant.isLocal,
  }));

  const stopLoop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const cleanupCanvas = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopLoop]);

  const openCanvasPip = useCallback(async () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    stopLoop();
    const tick = () => ctx && drawScene(ctx, canvas.width, canvas.height, sceneRef.current);
    tick();
    timerRef.current = setInterval(tick, Math.round(1000 / FPS));
    if (!streamRef.current) {
      streamRef.current = canvas.captureStream(FPS);
      video.srcObject = streamRef.current;
    }
    await video.play().catch(() => {});
    await video.requestPictureInPicture();
    setIsActive(true);
  }, [stopLoop]);

  const openDocPip = useCallback(async () => {
    const win = await openPipWindow(PIP_W, PIP_H);
    // The window's own close button fires `pagehide` — mirror it into state + drop the portal.
    win.addEventListener("pagehide", () => {
      setPipWindow(null);
      setIsActive(false);
    });
    setPipWindow(win);
    setIsActive(true);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (isActive) {
        if (pipWindow) pipWindow.close();
        else if (document.pictureInPictureElement) await document.exitPictureInPicture();
        return;
      }
      if (docPip) await openDocPip();
      else if (nativePip) await openCanvasPip();
    } catch {
      cleanupCanvas();
      if (pipWindow) {
        try {
          pipWindow.close();
        } catch {
          /* already gone */
        }
      }
      setPipWindow(null);
      setIsActive(false);
    }
  }, [isActive, pipWindow, docPip, nativePip, openDocPip, openCanvasPip, cleanupCanvas]);

  // The native-PiP window's close button fires leavepictureinpicture — mirror it (canvas path).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLeave = () => {
      cleanupCanvas();
      setIsActive(false);
    };
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => video.removeEventListener("leavepictureinpicture", onLeave);
  }, [cleanupCanvas]);

  // Tear everything down if the call surface unmounts while PiP is open.
  useEffect(() => {
    return () => {
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
      cleanupCanvas();
    };
  }, [cleanupCanvas]);

  // Close the Document-PiP window when it changes out or the provider unmounts.
  useEffect(() => {
    return () => {
      if (pipWindow) {
        try {
          pipWindow.close();
        } catch {
          /* already gone */
        }
      }
    };
  }, [pipWindow]);

  return (
    <PipContext.Provider value={{ supported, isActive, toggle }}>
      {children}
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="hidden" aria-hidden />
      <video ref={videoRef} muted playsInline className="hidden" aria-hidden />
      {pipWindow && createPortal(<PipGrid />, pipWindow.document.body)}
    </PipContext.Provider>
  );
}

function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, scene: SceneItem[]): void {
  ctx.fillStyle = "#0f172a"; // slate-900
  ctx.fillRect(0, 0, W, H);
  if (scene.length === 0) return;

  // Index the stage's live tile <video>s by participant identity — these are already decoding.
  const videos = new Map<string, HTMLVideoElement>();
  document.querySelectorAll<HTMLElement>("[data-pip-id]").forEach((host) => {
    const id = host.getAttribute("data-pip-id");
    const v = host.querySelector("video");
    if (id && v) videos.set(id, v);
  });

  const cells = pipCells(scene.length, W, H);
  scene.forEach((item, i) => {
    const cell = cells[i];
    if (!cell) return;
    const pad = 5;
    const x = cell.x + pad;
    const y = cell.y + pad;
    const w = cell.w - pad * 2;
    const h = cell.h - pad * 2;

    ctx.save();
    roundRect(ctx, x, y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = "#1e293b"; // slate-800
    ctx.fillRect(x, y, w, h);

    const vid = videos.get(item.id);
    if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
      const { sx, sy, sw, sh } = coverCrop(vid.videoWidth, vid.videoHeight, w, h);
      if (item.isLocal) {
        ctx.save();
        ctx.translate(x + w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(vid, sx, sy, sw, sh, x, y, w, h);
      }
    } else {
      drawAvatar(ctx, item.label, x, y, w, h);
    }

    // Name + mute strip along the bottom.
    const barH = Math.min(26, h * 0.24);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y + h - barH, w, barH);
    let textX = x + 8;
    if (item.muted) {
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(x + 12, y + h - barH / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      textX = x + 22;
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(barH * 0.5)}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(ellipsize(ctx, item.label, w - (textX - x) - 8), textX, y + h - barH / 2 + 1);
    ctx.restore();
  });
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const r = Math.min(w, h) * 0.22;
  const cx = x + w / 2;
  const cy = y + h / 2 - h * 0.05;
  ctx.fillStyle = "#334155"; // slate-700
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `${Math.round(r)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials(label), cx, cy + 1);
  ctx.textAlign = "start";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
