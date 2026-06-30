// Pure authoring helpers for the interactive overlay — turning the teacher's pointer gestures into
// Excalidraw-shaped annotation elements (in SHARE_W share-frame units), plus eraser hit-testing.
// Kept free of DOM/IPC so the geometry is simple to reason about (and unit-testable if desktop ever
// gains a test runner). The painter (overlay.ts) owns the canvas + event wiring; this owns the math.
export type Pt = [number, number];

export type ToolKind =
  | "select"
  | "pen"
  | "line"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "eraser";

/** The element shape we author — a structural subset of an Excalidraw element (matches overlay.ts). */
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

/** A scene element as the overlay receives it back from the room (only the fields we read here). */
export interface SceneEl {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: Pt[];
  strokeWidth?: number;
  isDeleted?: boolean;
  version?: number;
}

export function randomNonce(): number {
  return (Math.random() * 1e9) | 0;
}

function newId(): string {
  return `sa-d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Whether a tool draws a freehand path (vs. a two-point/bbox shape). */
export function isPathTool(tool: ToolKind): boolean {
  return tool === "pen";
}

/** Begin an element at the down-point for a drawing tool. Returns null for non-drawing tools. */
export function beginElement(
  tool: ToolKind,
  p: Pt,
  color: string,
  width: number,
): AuthoredEl | null {
  if (tool === "select" || tool === "eraser") return null;
  const base = {
    id: newId(),
    x: 0,
    y: 0,
    strokeColor: color,
    strokeWidth: width,
    opacity: 100,
    isDeleted: false,
    version: 1,
    versionNonce: randomNonce(),
  } as const;
  if (tool === "pen") return { ...base, type: "freedraw", points: [p] };
  if (tool === "line") return { ...base, type: "line", points: [p, p] };
  if (tool === "arrow") return { ...base, type: "arrow", points: [p, p] };
  // rectangle / ellipse: anchor the origin at the down-point, grow width/height as the pointer moves.
  return { ...base, type: tool, x: p[0], y: p[1], width: 0, height: 0, points: undefined };
}

/** Extend an in-progress element to the current pointer position (mutates + bumps the version). */
export function extendElement(el: AuthoredEl, tool: ToolKind, p: Pt): void {
  el.version += 1;
  if (tool === "pen") {
    el.points!.push(p);
  } else if (tool === "line" || tool === "arrow") {
    el.points![1] = p; // second point follows the cursor
  } else {
    // rectangle / ellipse — keep the origin at the start, size from start→cursor (can be negative).
    el.width = p[0] - el.x;
    el.height = p[1] - el.y;
  }
}

/** Distance from point `p` to segment a→b, in share units. */
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
export function hitsElement(el: SceneEl, p: Pt, radius: number): boolean {
  if (el.isDeleted) return false;
  const ox = el.x ?? 0;
  const oy = el.y ?? 0;
  const tol = radius + (el.strokeWidth ?? 2) / 2;
  if (el.points && el.points.length > 0) {
    const abs = el.points.map((q) => [ox + q[0], oy + q[1]] as Pt);
    if (abs.length === 1) return Math.hypot(p[0] - abs[0]![0], p[1] - abs[0]![1]) <= tol;
    for (let i = 1; i < abs.length; i++) {
      if (distToSegment(p, abs[i - 1]!, abs[i]!) <= tol) return true;
    }
    return false;
  }
  // bbox shape (rect/ellipse): hit if the point is near any edge OR inside.
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  const x0 = Math.min(ox, ox + w) - tol;
  const x1 = Math.max(ox, ox + w) + tol;
  const y0 = Math.min(oy, oy + h) - tol;
  const y1 = Math.max(oy, oy + h) + tol;
  return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
}

/** Build the "delete this element" delta (a version-bumped tombstone) for an erased/undone element. */
export function tombstone(el: SceneEl): AuthoredEl {
  return {
    id: el.id,
    type: (el.type as AuthoredEl["type"]) ?? "freedraw",
    x: el.x ?? 0,
    y: el.y ?? 0,
    width: el.width,
    height: el.height,
    points: el.points,
    strokeColor: "#000000",
    strokeWidth: el.strokeWidth ?? 2,
    opacity: 100,
    isDeleted: true,
    version: (el.version ?? 1) + 1,
    versionNonce: randomNonce(),
  };
}
