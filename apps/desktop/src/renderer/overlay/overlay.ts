// The annotation overlay painter + (Phase 5) the teacher's own authoring surface. It receives the
// room's annotation elements (Excalidraw-shaped, in SHARE_W share-frame units) over IPC and paints
// them on a transparent canvas spanning the shared display, so they bake into the screen-share
// capture. When the teacher picks a drawing tool in the toolbar, main makes this window interactive
// and pushes the tool; the overlay then captures the pointer, authors strokes (in the SAME share-frame
// units the web uses), and sends them back to main → the web call client → students (the overlay has
// no LiveKit connection of its own).
//
// Deliberately a lean canvas painter, NOT Excalidraw: the overlay only needs to draw + capture simple
// freehand/shape gestures, must be truly transparent, and featherweight. It reuses the PROTOCOL (the
// same elements the whiteboard channel carries), not the editor.
import {
  beginElement,
  extendElement,
  hitsElement,
  tombstone,
  type AuthoredEl,
  type SceneEl,
  type ToolKind,
} from "./authoring";
import { SHARE_W, shareFrameHeight } from "./coords";

type Pt = [number, number];

/** The subset of an Excalidraw element this painter understands. Unknown fields are ignored. */
interface El {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: Pt[];
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  isDeleted?: boolean;
  version?: number;
}

interface ToolState {
  tool: ToolKind;
  color: string;
  width: number;
}

declare global {
  interface Window {
    academiqOverlay?: {
      onMeta(cb: (m: unknown) => void): () => void;
      onScene(cb: (elements: El[]) => void): () => void;
      onTool(cb: (t: ToolState) => void): () => void;
      onCommand(cb: (c: "undo" | "redo") => void): () => void;
      author(elements: unknown[]): void;
    };
  }
}

const canvas = document.getElementById("grid") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let scene: El[] = [];
let tool: ToolState = { tool: "pen", color: "#ef4444", width: 6 };
// The shared display's NATIVE pixel size (from overlay:meta). The share frame's height is keyed on
// this aspect — the SAME one the web student uses (their video's natural size) — so marks the student
// draws bake back at the exact spot. Falls back to the window aspect until meta arrives.
let displayW = 0;
let displayH = 0;

// In-progress authoring state.
let active: AuthoredEl | null = null;
let drawing = false;
let lastSent = 0;
const SEND_THROTTLE_MS = 45;
const ERASER_RADIUS = 14; // share units

// Undo/redo of the teacher's own marks. We only need ids — the (possibly deleted) elements live on
// in `scene` (the merge keeps tombstones), so redo can resurrect them.
const undoStack: string[] = [];
const redoStack: string[] = [];

window.academiqOverlay?.onScene((elements) => {
  scene = Array.isArray(elements) ? elements : [];
  redraw();
});
window.academiqOverlay?.onMeta((m) => {
  const meta = m as { width?: number; height?: number } | null;
  displayW = meta?.width ?? 0;
  displayH = meta?.height ?? 0;
  redraw();
});
window.academiqOverlay?.onTool((t) => {
  tool = t;
  document.body.style.cursor =
    t.tool === "select" ? "default" : t.tool === "eraser" ? "cell" : "crosshair";
});
window.academiqOverlay?.onCommand((c) => (c === "undo" ? undo() : redo()));
window.addEventListener("resize", redraw);

// ---- Authoring (pointer capture) ----------------------------------------------------------------

/** The share frame's height (scene units) for the current display — native aspect if known, else the
 * window's own aspect. Keep identical to the web's `shareFrameHeight(video.natural*)`. */
function frameHeight(cssW: number, cssH: number): number {
  if (displayW > 0 && displayH > 0) return shareFrameHeight(displayW, displayH);
  return cssW > 0 ? (SHARE_W * cssH) / cssW : SHARE_W;
}

/** Map an overlay CSS-pixel pointer position to share-frame units (x by width, y by the share-frame
 * height — NOT a uniform scale, so it lines up with the web even if the window aspect drifts). */
function sharePoint(e: PointerEvent): Pt {
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const shareH = frameHeight(cssW, cssH);
  return [cssW > 0 ? (e.clientX * SHARE_W) / cssW : 0, cssH > 0 ? (e.clientY * shareH) / cssH : 0];
}

/** Optimistically apply an authored delta into the local scene so the mark shows instantly. */
function applyLocal(el: AuthoredEl): void {
  const i = scene.findIndex((s) => s.id === el.id);
  if (i >= 0) scene[i] = el as unknown as El;
  else scene.push(el as unknown as El);
}

function sendActive(force: boolean): void {
  if (!active) return;
  const now = Date.now();
  if (!force && now - lastSent < SEND_THROTTLE_MS) return;
  lastSent = now;
  // Send a copy so later mutation of the in-progress stroke doesn't alias the broadcast element.
  const copy: AuthoredEl = { ...active, points: active.points ? [...active.points] : undefined };
  applyLocal(copy);
  window.academiqOverlay?.author([copy]);
}

canvas.addEventListener("pointerdown", (e) => {
  if (tool.tool === "select") return;
  if (tool.tool === "eraser") {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    eraseAt(sharePoint(e));
    return;
  }
  active = beginElement(tool.tool, sharePoint(e), tool.color, tool.width);
  if (!active) return;
  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  sendActive(true);
  redraw();
});

canvas.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const p = sharePoint(e);
  if (tool.tool === "eraser") {
    eraseAt(p);
    return;
  }
  if (!active) return;
  extendElement(active, tool.tool, p);
  redraw();
  sendActive(false);
});

function endStroke(): void {
  if (!drawing) return;
  drawing = false;
  if (tool.tool === "eraser") return;
  if (!active) return;
  active.version += 1;
  sendActive(true); // final, complete element
  undoStack.push(active.id);
  redoStack.length = 0;
  active = null;
  redraw();
}

canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

function eraseAt(p: Pt): void {
  for (let i = scene.length - 1; i >= 0; i--) {
    const el = scene[i] as SceneEl;
    if (hitsElement(el, p, ERASER_RADIUS)) {
      const dead = tombstone(el);
      applyLocal(dead);
      window.academiqOverlay?.author([dead]);
      redraw();
      break; // one element per move tick keeps it predictable
    }
  }
}

function undo(): void {
  while (undoStack.length) {
    const id = undoStack.pop()!;
    const el = scene.find((s) => s.id === id) as SceneEl | undefined;
    if (!el || el.isDeleted) continue; // already gone — keep popping
    const dead = tombstone(el);
    applyLocal(dead);
    window.academiqOverlay?.author([dead]);
    redoStack.push(id);
    redraw();
    return;
  }
}

function redo(): void {
  while (redoStack.length) {
    const id = redoStack.pop()!;
    const el = scene.find((s) => s.id === id) as SceneEl | undefined;
    if (!el || !el.isDeleted) continue;
    const alive: AuthoredEl = {
      ...(el as unknown as AuthoredEl),
      isDeleted: false,
      version: (el.version ?? 1) + 1,
      versionNonce: (Math.random() * 1e9) | 0,
    };
    applyLocal(alive);
    window.academiqOverlay?.author([alive]);
    undoStack.push(id);
    redraw();
    return;
  }
}

// ---- Painting -----------------------------------------------------------------------------------

function redraw(): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // share units → device px. X scales by width; Y scales by the share-frame height (native display
  // aspect), so a mark lands at the same FRACTION of the screen the web placed it at — fixing the
  // vertical drift between a student's web canvas and the baked overlay. dpr composes CSS→device.
  const shareH = frameHeight(cssW, cssH);
  const kx = (cssW / SHARE_W) * dpr;
  const ky = (cssH / shareH) * dpr;
  ctx.setTransform(kx, 0, 0, ky, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const el of scene) {
    if (el.isDeleted || !el.type) continue;
    if (active && el.id === active.id) continue; // the in-progress copy is drawn from `active`
    drawElement(el);
  }
  if (active) drawElement(active as unknown as El);
}

function drawElement(el: El): void {
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  ctx.globalAlpha = (el.opacity ?? 100) / 100;
  ctx.strokeStyle = el.strokeColor ?? "#111827";
  ctx.fillStyle = el.strokeColor ?? "#111827";
  ctx.lineWidth = el.strokeWidth ?? 2;
  const fill = el.backgroundColor && el.backgroundColor !== "transparent" ? el.backgroundColor : null;

  switch (el.type) {
    case "freedraw":
    case "line":
    case "draw": {
      strokePoints(x, y, el.points);
      break;
    }
    case "arrow": {
      strokePoints(x, y, el.points);
      drawArrowhead(x, y, el.points, el.strokeWidth ?? 2);
      break;
    }
    case "rectangle": {
      const w = el.width ?? 0;
      const h = el.height ?? 0;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = el.strokeColor ?? "#111827";
      }
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case "diamond": {
      const w = el.width ?? 0;
      const h = el.height ?? 0;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.fillStyle = el.strokeColor ?? "#111827";
      }
      ctx.stroke();
      break;
    }
    case "ellipse": {
      const w = el.width ?? 0;
      const h = el.height ?? 0;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.fillStyle = el.strokeColor ?? "#111827";
      }
      ctx.stroke();
      break;
    }
    case "text": {
      const size = el.fontSize ?? 20;
      ctx.font = `${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(el.text ?? "", x, y);
      break;
    }
  }
  ctx.globalAlpha = 1;
}

function strokePoints(x: number, y: number, points: Pt[] | undefined): void {
  if (!points || points.length === 0) return;
  ctx.beginPath();
  let first = true;
  for (const p of points) {
    const px = x + (p[0] ?? 0);
    const py = y + (p[1] ?? 0);
    if (first) {
      ctx.moveTo(px, py);
      first = false;
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
}

function drawArrowhead(x: number, y: number, points: Pt[] | undefined, strokeWidth: number): void {
  if (!points || points.length < 2) return;
  const tip = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const tx = x + (tip[0] ?? 0);
  const ty = y + (tip[1] ?? 0);
  const angle = Math.atan2((tip[1] ?? 0) - (prev[1] ?? 0), (tip[0] ?? 0) - (prev[0] ?? 0));
  const len = Math.max(12, strokeWidth * 4);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - len * Math.cos(angle - spread), ty - len * Math.sin(angle - spread));
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - len * Math.cos(angle + spread), ty - len * Math.sin(angle + spread));
  ctx.stroke();
}
