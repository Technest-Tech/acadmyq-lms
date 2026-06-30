"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  SHARE_W,
  shareFrameHeight,
  videoContentRect,
  pointerToShare,
  type ContentRect,
} from "./screen-annotate-coords";
import {
  beginElement,
  extendElement,
  hitsElement,
  tombstone,
  type AnnotateTool,
  type AuthoredEl,
} from "./screen-annotate-authoring";
import { ScreenAnnotateToolbar } from "./screen-annotate-toolbar";
import { useWhiteboard, type BoardElement } from "./whiteboard-context";

// The web authoring + rendering surface for screen-share annotation. It sits over the shared-screen
// video tile and, when the local user `canDraw`, turns pointer gestures into Excalidraw-shaped elements
// (pen/line/arrow/rectangle/ellipse, plus an eraser) in SHARE_W share-frame units, and pushes them into
// the whiteboard channel's screen-annotation lane. A floating toolbar lets the viewer pick the
// tool/colour/width — the same controls the desktop teacher has natively.
//
// Rendering: when the sharer BAKES marks into the video (desktop overlay), we paint only the local
// in-progress stroke (the scene is already in the video). Otherwise the canvas is the sole renderer and
// paints the full scene. No-ops in pure web when nobody draws; never touches the Excalidraw board.

const ERASER_RADIUS = 14; // share units
const SEND_THROTTLE_MS = 45;

export function ScreenAnnotateLayer() {
  const {
    canDraw,
    canManage,
    screenAnnotations,
    pushScreenAnnotation,
    clearScreenAnnotations,
    screenBaking,
  } = useWhiteboard();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<AuthoredEl | null>(null);
  const erasingRef = useRef(false);
  const lastSentRef = useRef(0);

  const [tool, setTool] = useState<AnnotateTool>("pen");
  const [color, setColor] = useState("#ef4444");
  const [width, setWidth] = useState(6);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Ids this user authored (so eraser/undo/clear scope to their own marks unless they can manage).
  const ownIds = useRef<Set<string>>(new Set());
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  // Always-current scene for hit-testing / undo lookups inside event handlers.
  const sceneRef = useRef<readonly BoardElement[]>(screenAnnotations);
  sceneRef.current = screenAnnotations;

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
    // While the sharer bakes marks into the video, the scene is already in the video pixels — painting
    // it again would double every mark. So we draw ONLY the local in-progress stroke then. A plain-web
    // sharer doesn't bake, so the canvas paints the whole scene.
    if (!screenBaking) {
      for (const el of screenAnnotations) drawElement(ctx, el, rect, shareH);
    }
    if (activeRef.current) {
      drawElement(ctx, activeRef.current as unknown as BoardElement, rect, shareH);
    }
  }, [screenAnnotations, screenBaking, findVideo]);

  useEffect(() => {
    draw();
  }, [draw]);

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
      pushScreenAnnotation([{ ...s, points: s.points ? [...s.points] : undefined } as unknown as BoardElement]);
    },
    [pushScreenAnnotation],
  );

  // Erase the topmost element under the pointer the user is allowed to remove (own marks always; any
  // mark if they can manage the room).
  const eraseAt = useCallback(
    (p: [number, number]) => {
      const scene = sceneRef.current;
      for (let i = scene.length - 1; i >= 0; i--) {
        const el = scene[i]!;
        const id = el.id as string;
        if (!hitsElement(el, p, ERASER_RADIUS)) continue;
        if (!canManage && !ownIds.current.has(id)) continue;
        pushScreenAnnotation([tombstone(el)]);
        break;
      }
    },
    [canManage, pushScreenAnnotation],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!canDraw) return;
      const video = findVideo();
      if (!video) return;
      const rect = videoContentRect(video);
      const p = pointerToShare(rect, e.clientX, e.clientY);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (toolRef.current === "eraser") {
        activeRef.current = null;
        erasingRef.current = true;
        eraseAt(p);
        return;
      }
      activeRef.current = beginElement(toolRef.current, p, color, width);
      if (!activeRef.current) return;
      sendActive(true);
      draw();
    },
    [canDraw, findVideo, color, width, eraseAt, sendActive, draw],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const video = findVideo();
      if (!video) return;
      const rect = videoContentRect(video);
      const p = pointerToShare(rect, e.clientX, e.clientY);
      if (toolRef.current === "eraser") {
        if (erasingRef.current) eraseAt(p);
        return;
      }
      const s = activeRef.current;
      if (!s) return;
      extendElement(s, toolRef.current, p);
      draw();
      sendActive(false);
    },
    [findVideo, eraseAt, draw, sendActive],
  );

  const onPointerUp = useCallback(() => {
    erasingRef.current = false;
    const s = activeRef.current;
    if (!s) return;
    s.version += 1;
    sendActive(true); // final, complete element
    ownIds.current.add(s.id);
    undoStack.current.push(s.id);
    redoStack.current.length = 0;
    activeRef.current = null;
    draw();
  }, [sendActive, draw]);

  const undo = useCallback(() => {
    while (undoStack.current.length) {
      const id = undoStack.current.pop()!;
      const el = sceneRef.current.find((e) => e.id === id);
      if (!el || (el as { isDeleted?: boolean }).isDeleted) continue;
      pushScreenAnnotation([tombstone(el)]);
      redoStack.current.push(id);
      return;
    }
  }, [pushScreenAnnotation]);

  const redo = useCallback(() => {
    while (redoStack.current.length) {
      const id = redoStack.current.pop()!;
      const el = sceneRef.current.find((e) => e.id === id);
      if (!el || !(el as { isDeleted?: boolean }).isDeleted) continue;
      const e = el as Record<string, unknown>;
      pushScreenAnnotation([
        { ...(el as object), isDeleted: false, version: ((e["version"] as number) ?? 1) + 1, versionNonce: (Math.random() * 1e9) | 0 } as unknown as BoardElement,
      ]);
      undoStack.current.push(id);
      return;
    }
  }, [pushScreenAnnotation]);

  const clear = useCallback(() => {
    if (canManage) {
      clearScreenAnnotations();
      return;
    }
    // A non-host clears only their OWN marks.
    const mine = sceneRef.current.filter(
      (el) => ownIds.current.has(el.id as string) && !(el as { isDeleted?: boolean }).isDeleted,
    );
    if (mine.length > 0) pushScreenAnnotation(mine.map((el) => tombstone(el)));
  }, [canManage, clearScreenAnnotations, pushScreenAnnotation]);

  if (!canDraw) {
    // Read-only viewer: still render the scene (when not baking), but no surface + no toolbar.
    return (
      <div ref={rootRef} className="pointer-events-none absolute inset-0 z-10">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-10"
      style={{ touchAction: "none", cursor: tool === "eraser" ? "cell" : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} className="h-full w-full" style={{ pointerEvents: "none" }} />
      <ScreenAnnotateToolbar
        tool={tool}
        color={color}
        width={width}
        onTool={setTool}
        onColor={setColor}
        onWidth={setWidth}
        onUndo={undo}
        onRedo={redo}
        onClear={clear}
      />
    </div>
  );
}

/** Map share-frame coords → canvas px and paint one element (all supported tool shapes). */
function drawElement(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  rect: ContentRect,
  shareH: number,
): void {
  const e = el as Record<string, unknown>;
  if (e["isDeleted"]) return;
  const sx = rect.w / SHARE_W;
  const sy = rect.h / shareH;
  const ox = typeof e["x"] === "number" ? (e["x"] as number) : 0;
  const oy = typeof e["y"] === "number" ? (e["y"] as number) : 0;
  const toPx = (px: number, py: number): [number, number] => [rect.x + (ox + px) * sx, rect.y + (oy + py) * sy];

  ctx.strokeStyle = typeof e["strokeColor"] === "string" ? (e["strokeColor"] as string) : "#ef4444";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1, (typeof e["strokeWidth"] === "number" ? (e["strokeWidth"] as number) : 4) * sx);
  ctx.globalAlpha = (typeof e["opacity"] === "number" ? (e["opacity"] as number) : 100) / 100;

  const type = e["type"] as string | undefined;
  const points = e["points"] as Array<[number, number]> | undefined;
  const w = (typeof e["width"] === "number" ? (e["width"] as number) : 0) * sx;
  const h = (typeof e["height"] === "number" ? (e["height"] as number) : 0) * sy;
  const [x0, y0] = toPx(0, 0);

  switch (type) {
    case "rectangle":
      ctx.strokeRect(x0, y0, w, h);
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(x0 + w / 2, y0 + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "arrow":
    case "line":
    case "freedraw":
    default: {
      if (!points || points.length === 0) break;
      ctx.beginPath();
      points.forEach((p, i) => {
        const [px, py] = toPx(p[0] ?? 0, p[1] ?? 0);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      if (type === "arrow" && points.length >= 2) drawArrowhead(ctx, points, toPx, ctx.lineWidth);
      break;
    }
  }
  ctx.globalAlpha = 1;
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  toPx: (px: number, py: number) => [number, number],
  lineWidth: number,
): void {
  const tip = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const [tx, ty] = toPx(tip[0] ?? 0, tip[1] ?? 0);
  const [px, py] = toPx(prev[0] ?? 0, prev[1] ?? 0);
  const angle = Math.atan2(ty - py, tx - px);
  const len = Math.max(10, lineWidth * 4);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - len * Math.cos(angle - spread), ty - len * Math.sin(angle - spread));
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - len * Math.cos(angle + spread), ty - len * Math.sin(angle + spread));
  ctx.stroke();
}
