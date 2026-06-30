// The annotation overlay painter. It receives the room's annotation elements (Excalidraw-shaped,
// authored in SHARE_W share-frame units) over IPC and paints them on a transparent canvas spanning
// the shared display, so they bake into the screen-share capture. Render-only — never authors.
//
// Deliberately a lean canvas painter, NOT Excalidraw: the overlay only needs to DRAW (no tools,
// selection, menus), must be truly transparent + click-through, and featherweight. It reuses the
// PROTOCOL (the same elements the whiteboard channel carries), not the editor.
import { SHARE_W } from "./coords";

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
}

declare global {
  interface Window {
    academiqOverlay?: {
      onMeta(cb: (m: unknown) => void): () => void;
      onScene(cb: (elements: El[]) => void): () => void;
    };
  }
}

const canvas = document.getElementById("grid") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let scene: El[] = [];

window.academiqOverlay?.onScene((elements) => {
  scene = Array.isArray(elements) ? elements : [];
  redraw();
});
window.academiqOverlay?.onMeta(() => redraw());
window.addEventListener("resize", redraw);

function redraw(): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // share units → device px: uniform scale k (share→CSS) composed with dpr (CSS→device).
  const k = (cssW / SHARE_W) * dpr;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const el of scene) {
    if (!el.isDeleted && el.type) drawElement(el);
  }
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
