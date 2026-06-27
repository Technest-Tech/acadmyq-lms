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
import { useParticipants, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { coverCrop, pipCells } from "./pip-layout";

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

interface SceneItem {
  id: string;
  label: string;
  muted: boolean;
  isLocal: boolean;
}

/**
 * Provides a native Picture-in-Picture floating window that shows ALL participants Zoom-style. A hidden
 * canvas composites every camera (cover-fit grid + name/mute overlays) on a ~12fps loop; its
 * captureStream() feeds a hidden <video> handed to requestPictureInPicture(). Audio keeps playing from
 * the page's RoomAudioRenderer, so you see AND hear the room while working in another tab/app.
 *
 * Frames are sampled from the stage's already-rendered tile <video>s (tagged `data-pip-id`) — every
 * participant always has a tile, so there's no second decode (a remote track only decodes into one
 * sink) and no extra subscription. (Caveat: a fully-hidden tab throttles the canvas redraw — video
 * gets choppy in deep background while audio stays full.) Gated on `document.pictureInPictureEnabled`.
 */
export function CompositePipProvider({ children }: { children: ReactNode }) {
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  useParticipants(); // re-render on mic/identity changes so the scene + overlays stay fresh

  const [isActive, setIsActive] = useState(false);
  const supported = typeof document !== "undefined" && !!document.pictureInPictureEnabled;

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

  const cleanup = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopLoop]);

  const toggle = useCallback(async () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!supported || !canvas || !video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return; // leavepictureinpicture handler tears down
      }
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
    } catch {
      cleanup();
      setIsActive(false);
    }
  }, [supported, stopLoop, cleanup]);

  // The window's own close button fires leavepictureinpicture — mirror it into our state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLeave = () => {
      cleanup();
      setIsActive(false);
    };
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => video.removeEventListener("leavepictureinpicture", onLeave);
  }, [cleanup]);

  // Tear everything down if the call surface unmounts while PiP is open.
  useEffect(() => {
    return () => {
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
      cleanup();
    };
  }, [cleanup]);

  return (
    <PipContext.Provider value={{ supported, isActive, toggle }}>
      {children}
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="hidden" aria-hidden />
      <video ref={videoRef} muted playsInline className="hidden" aria-hidden />
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
