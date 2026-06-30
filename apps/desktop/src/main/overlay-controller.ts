import { screen, type Display } from "electron";
import { isDev } from "./env";
import { hideOverlay, showOverlayOnDisplay } from "./window-overlay";

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

function reconcile(): void {
  const display =
    getSharedDisplay() ?? (isDev && annotateArmed ? screen.getPrimaryDisplay() : null);
  if (annotateArmed && display) showOverlayOnDisplay(display);
  else hideOverlay();
}
