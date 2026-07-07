import { screen, type Display } from "electron";
import { isDev } from "./env";
import {
  hideOverlay,
  postToolToOverlay,
  setOverlayInteractive,
  showOverlayOnDisplay,
} from "./window-overlay";
import { getToolbarBounds, hideToolbar, showToolbar } from "./window-toolbar";
import { getMainWindow } from "./window-main";
import { isPresenterActive } from "./presenter-controller";

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

// Hover pass-through. While a drawing tool is active the overlay captures the WHOLE shared screen
// (every click becomes a stroke). To keep the floating controls usable, poll the cursor and let the
// mouse pass THROUGH the overlay whenever it's over a control window — the toolbar or the presenter
// card — so those become clickable and the pen turns back into a normal mouse there. Over the rest of
// the screen the overlay captures and draws. This is what makes drawing mode escapable on Windows,
// where topmost z-ordering doesn't reliably keep the controls above a pointer-capturing overlay.
let hoverTimer: ReturnType<typeof setInterval> | null = null;
let lastInteractive: boolean | null = null;

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
 * Apply the teacher's tool pick: forward it to the overlay (cursor + authoring). A drawing tool hands
 * interactivity to the hover tracker (draw over the screen, pass-through over the controls); "select"
 * makes the overlay fully click-through so the teacher can keep using their PC.
 */
export function setTool(tool: AnnotationTool): void {
  currentTool = tool;
  postToolToOverlay(tool);
  if (!annotateArmed) return;
  applyToolInteractivity();
}

/** The control windows the mouse must pass through to (so the pen becomes a normal mouse over them). */
function controlRects(): Electron.Rectangle[] {
  const rects: Electron.Rectangle[] = [];
  const toolbar = getToolbarBounds();
  if (toolbar) rects.push(toolbar);
  // The presenter card (mic/cam/annotate/leave PiP controls). Annotation is only ever armed while the
  // teacher is presenting, so the main window here is that small floating card.
  const main = getMainWindow();
  if (main && !main.isDestroyed() && main.isVisible() && isPresenterActive()) {
    rects.push(main.getBounds());
  }
  return rects;
}

function cursorOverControl(): boolean {
  const p = screen.getCursorScreenPoint();
  return controlRects().some(
    (r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height,
  );
}

function startHoverPassthrough(): void {
  if (hoverTimer) return;
  lastInteractive = null;
  const tick = () => {
    // Draw when the cursor is over the screen; pass the mouse through when it's over a control.
    const interactive = !cursorOverControl();
    if (interactive !== lastInteractive) {
      lastInteractive = interactive;
      setOverlayInteractive(interactive);
    }
  };
  tick(); // apply immediately, don't wait a frame
  hoverTimer = setInterval(tick, 30);
}

function stopHoverPassthrough(): void {
  if (hoverTimer) {
    clearInterval(hoverTimer);
    hoverTimer = null;
  }
  lastInteractive = null;
}

/** For a drawing tool, run the hover tracker; for "select", stay click-through with no polling. */
function applyToolInteractivity(): void {
  if (currentTool.tool === "select") {
    stopHoverPassthrough();
    setOverlayInteractive(false);
  } else {
    startHoverPassthrough();
  }
}

function reconcile(): void {
  const display =
    getSharedDisplay() ?? (isDev && annotateArmed ? screen.getPrimaryDisplay() : null);
  if (annotateArmed && display) {
    showOverlayOnDisplay(display);
    showToolbar();
    applyToolInteractivity();
  } else {
    stopHoverPassthrough();
    setOverlayInteractive(false); // never leave the overlay capturing the pointer once disarmed
    hideOverlay();
    hideToolbar();
  }
}
