import { screen, type Display } from "electron";
import { isDev } from "./env";
import {
  hideOverlay,
  postToolToOverlay,
  setOverlayInteractive,
  showOverlayOnDisplay,
} from "./window-overlay";
import { hideToolbar, showToolbar } from "./window-toolbar";

/** The teacher's current authoring tool/style — pushed to the overlay; drives its interactivity. */
export interface AnnotationTool {
  tool: "select" | "pen" | "line" | "arrow" | "rectangle" | "ellipse" | "eraser";
  color: string;
  width: number;
}

let currentTool: AnnotationTool = { tool: "pen", color: "#ef4444", width: 6 };

/**
 * Owns the policy of WHEN and WHERE the annotation overlay appears:
 *   - which display is currently being shared (set by the display-capture handler), and
 *   - whether annotation is "armed".
 * The overlay shows only when annotation is armed AND a display is being shared, and it tracks the
 * shared display across monitor changes. (In dev we fall back to the primary display when armed
 * without a real share, so the overlay is testable with `pnpm dev` and no live call.)
 */
let sharedDisplayId: string | null = null;
let annotateArmed = false;
let initialized = false;

export function initOverlayController(): void {
  if (initialized) return;
  initialized = true;
  // Re-place the overlay if the shared display's geometry changes or monitors are added/removed.
  screen.on("display-metrics-changed", reconcile);
  screen.on("display-removed", reconcile);
  screen.on("display-added", reconcile);
}

/** Called by the display-capture handler with the chosen screen's `display_id` (null when sharing a window). */
export function setSharedDisplay(displayId: string | null): void {
  sharedDisplayId = displayId;
  reconcile();
}

export function clearShare(): void {
  sharedDisplayId = null;
  reconcile();
}

export function armAnnotate(on: boolean): void {
  annotateArmed = on;
  reconcile();
}

export function toggleAnnotate(): boolean {
  annotateArmed = !annotateArmed;
  reconcile();
  return annotateArmed;
}

export function isAnnotateArmed(): boolean {
  return annotateArmed;
}

export function getSharedDisplay(): Display | null {
  if (!sharedDisplayId) return null;
  return screen.getAllDisplays().find((d) => String(d.id) === sharedDisplayId) ?? null;
}

/**
 * Apply the teacher's tool pick: forward it to the overlay (cursor + authoring) and make the overlay
 * interactive (pointer-capturing) for any drawing tool, or click-through for "select" so the teacher
 * can keep using their PC. No-op for overlay placement, which `reconcile()` owns.
 */
export function setTool(tool: AnnotationTool): void {
  currentTool = tool;
  postToolToOverlay(tool);
  setOverlayInteractive(tool.tool !== "select");
}

function reconcile(): void {
  const display =
    getSharedDisplay() ?? (isDev && annotateArmed ? screen.getPrimaryDisplay() : null);
  if (annotateArmed && display) {
    showOverlayOnDisplay(display);
    showToolbar();
    // Re-assert interactivity for the current tool whenever we (re)show the overlay.
    setOverlayInteractive(currentTool.tool !== "select");
  } else {
    setOverlayInteractive(false); // never leave the overlay capturing the pointer once disarmed
    hideOverlay();
    hideToolbar();
  }
}
