// Pure authoring helpers for web screen-share annotation — turning a viewer's pointer gestures into
// Excalidraw-shaped elements (in SHARE_W share-frame units) and eraser hit-testing. The web twin of
// apps/desktop's overlay authoring, kept identical so a mark a student draws bakes back the same shape
// the teacher's overlay paints. No DOM/React here — just the geometry.
import { SHARE_W } from "./screen-annotate-coords";
import type { BoardElement } from "./whiteboard-context";

export type Pt = [number, number];

export type AnnotateTool = "pen" | "line" | "arrow" | "rectangle" | "ellipse" | "eraser";

/** The structural element shape we author (a subset of an Excalidraw element). */
export interface AuthoredEl {
  id: string;
  type: "freedraw" | "line" | "arrow" | "rectangle" | "ellipse";
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Pt[];
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  isDeleted: boolean;
  version: number;
  versionNonce: number;
}

function randomNonce(): number {
  return (Math.random() * 1e9) | 0;
}

function newId(): string {
  return `sa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Begin an element at the down-point. (Eraser authors nothing — it deletes; see hitsElement.) */
export function beginElement(tool: AnnotateTool, p: Pt, color: string, width: number): AuthoredEl | null {
  if (tool === "eraser") return null;
  const base = {
    id: newId(),
    x: 0,
    y: 0,
    strokeColor: color,
    strokeWidth: width,
    opacity: 100,
    isDeleted: false as const,
    version: 1,
    versionNonce: randomNonce(),
  };
  if (tool === "pen") return { ...base, type: "freedraw", points: [p] };
  if (tool === "line") return { ...base, type: "line", points: [p, p] };
  if (tool === "arrow") return { ...base, type: "arrow", points: [p, p] };
  return { ...base, type: tool, x: p[0], y: p[1], width: 0, height: 0 };
}

/** Extend an in-progress element to the current pointer (mutates + bumps the version). */
export function extendElement(el: AuthoredEl, tool: AnnotateTool, p: Pt): void {
  el.version += 1;
  if (tool === "pen") el.points!.push(p);
  else if (tool === "line" || tool === "arrow") el.points![1] = p;
  else {
    el.width = p[0] - el.x;
    el.height = p[1] - el.y;
  }
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** True when share-point `p` is within `radius` share-units of element `el`'s geometry. */
export function hitsElement(el: BoardElement, p: Pt, radius: number): boolean {
  const e = el as Record<string, unknown>;
  if (e["isDeleted"]) return false;
  const ox = typeof e["x"] === "number" ? (e["x"] as number) : 0;
  const oy = typeof e["y"] === "number" ? (e["y"] as number) : 0;
  const sw = typeof e["strokeWidth"] === "number" ? (e["strokeWidth"] as number) : 2;
  const tol = radius + sw / 2;
  const points = e["points"] as Pt[] | undefined;
  if (points && points.length > 0) {
    const abs = points.map((q) => [ox + q[0], oy + q[1]] as Pt);
    if (abs.length === 1) return Math.hypot(p[0] - abs[0]![0], p[1] - abs[0]![1]) <= tol;
    for (let i = 1; i < abs.length; i++) {
      if (distToSegment(p, abs[i - 1]!, abs[i]!) <= tol) return true;
    }
    return false;
  }
  const w = typeof e["width"] === "number" ? (e["width"] as number) : 0;
  const h = typeof e["height"] === "number" ? (e["height"] as number) : 0;
  const x0 = Math.min(ox, ox + w) - tol;
  const x1 = Math.max(ox, ox + w) + tol;
  const y0 = Math.min(oy, oy + h) - tol;
  const y1 = Math.max(oy, oy + h) + tol;
  return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
}

/** A version-bumped tombstone (isDeleted) for an erased/undone element. */
export function tombstone(el: BoardElement): BoardElement {
  const e = el as Record<string, unknown>;
  return {
    ...(el as object),
    isDeleted: true,
    version: (typeof e["version"] === "number" ? (e["version"] as number) : 1) + 1,
    versionNonce: randomNonce(),
  } as BoardElement;
}

export { SHARE_W };
