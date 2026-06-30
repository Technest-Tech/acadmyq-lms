"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  SHARE_W,
  shareFrameHeight,
  videoContentRect,
  pointerToShare,
  type ContentRect,
} from "./screen-annotate-coords";
import { useWhiteboard, type BoardElement } from "./whiteboard-context";

// Phase 4b — the web authoring + rendering surface for screen-share annotation. It sits over the
// shared-screen video tile and:
//   • when the local user `canDraw`, turns pointer gestures into freedraw elements (in SHARE_W
//     share-frame units mapped from the object-contain video rect) and pushes them into the
//     whiteboard channel's screen-annotation lane;
//   • always renders the merged scene, so every viewer sees crisp marks aligned to the shared screen
//     (the teacher's desktop overlay additionally bakes them into the stream + recording).
// All of this no-ops in pure web when nobody draws; it never touches the Excalidraw board.

const STROKE_COLOR = "#ef4444"; // red — distinct from typical app chrome
const STROKE_WIDTH = 6; // share-frame units (Phase 5 adds a colour/width toolbar)
const SEND_THROTTLE_MS = 45;

interface ActiveStroke {
  id: string;
  type: "freedraw";
  x: 0;
  y: 0;
  points: Array<[number, number]>;
  strokeColor: string;
  strokeWidth: number;
  opacity: 100;
  isDeleted: false;
  version: number;
  versionNonce: number;
}

export function ScreenAnnotateLayer() {
  const { canDraw, screenAnnotations, pushScreenAnnotation } = useWhiteboard();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<ActiveStroke | null>(null);
  const lastSentRef = useRef(0);

  const findVideo = useCallback((): HTMLVideoElement | null => {
    const root = rootRef.current;
    if (!root) return null;
    return (root.parentElement?.querySelector("video") as HTMLVideoElement | null) ?? null;
  }, []);

  const draw = useCallback(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const cbox = root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cbox.width * dpr));
    canvas.height = Math.max(1, Math.round(cbox.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cbox.width, cbox.height);

    const video = findVideo();
    if (!video) return;
    const rect = videoContentRect(video, cbox.left, cbox.top);
    if (rect.w === 0) return;
    const shareH = shareFrameHeight(rect.naturalW, rect.naturalH);

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const el of screenAnnotations) drawStroke(ctx, el, rect, shareH);
    if (activeRef.current) {
      drawStroke(ctx, activeRef.current as unknown as BoardElement, rect, shareH);
    }
  }, [screenAnnotations, findVideo]);

  // Redraw when the scene changes…
  useEffect(() => {
    draw();
  }, [draw]);

  // …and when the tile or video resizes (responsive layouts, rotation, fullscreen).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(root);
    const video = findVideo();
    if (video) ro.observe(video);
    window.addEventListener("resize", draw);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [draw, findVideo]);

  const sendActive = useCallback(
    (force: boolean) => {
      const s = activeRef.current;
      if (!s) return;
      const now = Date.now();
      if (!force && now - lastSentRef.current < SEND_THROTTLE_MS) return;
      lastSentRef.current = now;
      // Send a copy so later mutations of the in-progress stroke don't alias the merged element.
      pushScreenAnnotation([{ ...s, points: [...s.points] } as unknown as BoardElement]);
    },
    [pushScreenAnnotation],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!canDraw) return;
      const video = findVideo();
      if (!video) return;
      const rect = videoContentRect(video);
      activeRef.current = {
        id: `sa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        type: "freedraw",
        x: 0,
        y: 0,
        points: [pointerToShare(rect, e.clientX, e.clientY)],
        strokeColor: STROKE_COLOR,
        strokeWidth: STROKE_WIDTH,
        opacity: 100,
        isDeleted: false,
        version: 1,
        versionNonce: (Math.random() * 1e9) | 0,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      sendActive(true);
      draw();
    },
    [canDraw, findVideo, sendActive, draw],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = activeRef.current;
      if (!s) return;
      const video = findVideo();
      if (!video) return;
      const rect = videoContentRect(video);
      s.points.push(pointerToShare(rect, e.clientX, e.clientY));
      s.version += 1;
      draw();
      sendActive(false);
    },
    [findVideo, draw, sendActive],
  );

  const onPointerUp = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current.version += 1;
    sendActive(true); // final, complete stroke
    activeRef.current = null;
    draw();
  }, [sendActive, draw]);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-10"
      style={{
        pointerEvents: canDraw ? "auto" : "none",
        touchAction: "none",
        cursor: canDraw ? "crosshair" : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} className="h-full w-full" style={{ pointerEvents: "none" }} />
    </div>
  );
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  rect: ContentRect,
  shareH: number,
): void {
  const e = el as Record<string, unknown>;
  if (e.isDeleted) return;
  const points = e.points as Array<[number, number]> | undefined;
  if (!points || points.length === 0) return;

  const ex = typeof e.x === "number" ? e.x : 0;
  const ey = typeof e.y === "number" ? e.y : 0;
  const sx = rect.w / SHARE_W;
  const sy = rect.h / shareH;

  ctx.strokeStyle = typeof e.strokeColor === "string" ? e.strokeColor : "#ef4444";
  ctx.lineWidth = Math.max(1, (typeof e.strokeWidth === "number" ? e.strokeWidth : 4) * sx);
  ctx.globalAlpha = (typeof e.opacity === "number" ? e.opacity : 100) / 100;

  ctx.beginPath();
  points.forEach((p, i) => {
    const px = rect.x + (ex + (p[0] ?? 0)) * sx;
    const py = rect.y + (ey + (p[1] ?? 0)) * sy;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
}
