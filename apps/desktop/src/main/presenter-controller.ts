import { screen } from "electron";
import { armAnnotate, clearShare, getSharedDisplay } from "./overlay-controller";
import { getMainWindow } from "./window-main";
import { hideOverlay, postSceneToOverlay } from "./window-overlay";
import { hideShareIndicator, showShareIndicator } from "./window-share-indicator";

/**
 * Presenter ("screen-share") mode. When the teacher shares their screen, the big call window shrinks
 * into a small, always-on-top, movable **floating panel** (participants + controls, rendered by the
 * web client's desktop-only presenter layout) so the teacher can use their PC normally.
 *
 * The panel IS the main window — that's deliberate. It's the only window that has both the LiveKit
 * connection (live participant tiles) AND can be content-protected: a Document-Picture-in-Picture
 * window has the connection but is invisible to Electron's main process (no handle → can't be
 * excluded from capture), and a brand-new BrowserWindow is protectable but has no connection. So we
 * reshape the main window and `setContentProtection(true)` it, which excludes it from the shared-screen
 * capture (NSWindowSharingNone / WDA_EXCLUDEFROMCAPTURE) — students see only the clean shared screen +
 * baked annotations, never the panel or the host's control chrome. The annotation overlay stays
 * capturable so drawings still bake in.
 *
 * `exitPresenter()` restores the window AND tears down the annotation overlay unconditionally — the
 * fix for the "stuck overlay after a share/call ends" bug (clearShare/armAnnotate were dead code).
 */
const PANEL_W = 384;
const PANEL_H = 312;
const BUBBLE_W = 224;
const BUBBLE_H = 132;
const EXPANDED_W = 880;
const EXPANDED_H = 620;
const MARGIN = 16;
const isMac = process.platform === "darwin";

let active = false;
let collapsed = false;
// Grown to the comfortable board/chat size when the teacher opens the whiteboard or the chat pane.
let expanded = false;
let savedBounds: Electron.Rectangle | null = null;
let savedMinSize: [number, number] | null = null;
let wasMaximized = false;

/** Anchor a panel of the given size to the top-trailing (right) corner of the shared display. */
function anchoredBounds(width: number, height: number): Electron.Rectangle {
  const display =
    getSharedDisplay() ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea; // respects menu bar / taskbar
  return {
    x: Math.round(wa.x + wa.width - width - MARGIN),
    y: Math.round(wa.y + MARGIN),
    width,
    height,
  };
}

/** The current size — a comfortable board/chat window when a section is open, else the compact panel. */
function expandedBounds(): Electron.Rectangle {
  const display =
    getSharedDisplay() ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const w = expanded ? Math.min(EXPANDED_W, wa.width - 2 * MARGIN) : PANEL_W;
  const h = expanded ? Math.min(EXPANDED_H, wa.height - 2 * MARGIN) : PANEL_H;
  return anchoredBounds(w, h);
}

function panelBounds(): Electron.Rectangle {
  return anchoredBounds(PANEL_W, PANEL_H);
}

/** Reshape + content-protect the call window into the floating presenter panel. */
export function enterPresenter(): void {
  const win = getMainWindow();
  if (!win || active) return;
  active = true;
  wasMaximized = win.isMaximized();
  savedBounds = win.getBounds();
  savedMinSize = win.getMinimumSize() as [number, number];

  collapsed = false;
  expanded = false;
  if (wasMaximized) win.unmaximize();
  if (isMac) win.setWindowButtonVisibility(false); // clean borderless card — no traffic lights
  win.setContentProtection(true); // exclude the panel from the shared-screen capture
  win.setMinimumSize(BUBBLE_W, BUBBLE_H); // allow the bubble (normal min is 960×600)
  win.setBounds(panelBounds());
  win.setAlwaysOnTop(true, "screen-saver"); // float above the teacher's other apps
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Zoom-style green "you're sharing" frame on the shared display (teacher-only — content-protected).
  const shared = getSharedDisplay() ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  showShareIndicator(shared);
}

/** Shrink the floating panel into a small bubble (the web swaps to its compact bubble UI). */
export function collapsePresenter(): void {
  const win = getMainWindow();
  if (!win || !active || collapsed) return;
  collapsed = true;
  win.setBounds(anchoredBounds(BUBBLE_W, BUBBLE_H));
}

/** Restore the bubble back to the full floating panel (board-sized if the whiteboard is open). */
export function expandPresenter(): void {
  const win = getMainWindow();
  if (!win || !active || !collapsed) return;
  collapsed = false;
  win.setBounds(expandedBounds());
}

/** The host opened/closed a section (whiteboard or chat) while presenting — grow to a usable window
 *  (or shrink back to the compact panel). No-op when collapsed (expand restores the right size). */
export function setPresenterExpanded(on: boolean): void {
  const win = getMainWindow();
  if (!win || !active || expanded === on) return;
  expanded = on;
  if (!collapsed) win.setBounds(expandedBounds());
}

/** Restore the call window and tear down the annotation overlay (also the stuck-overlay bug fix). */
export function exitPresenter(): void {
  // Overlay teardown — runs unconditionally so a stuck overlay can never survive share-stop, even if
  // enterPresenter never ran (e.g. a stale armed state, or a window share with no presenter reshape).
  armAnnotate(false); // reconcile() → hideOverlay() since no longer armed
  clearShare(); // forget the shared display
  postSceneToOverlay([]); // drop the remembered scene so a later share can't repaint stale marks
  hideOverlay(); // belt-and-suspenders
  hideShareIndicator(); // drop the green "sharing" frame

  const win = getMainWindow();
  // Reset the web Annotate toggle + baking flag so a stopped share never leaves a stale "on" button
  // (the overlay/toolbar are already torn down above). Harmless on a plain leave/unmount.
  win?.webContents.send("desktop:annotate-control", "off");

  if (win && active) {
    if (isMac) win.setWindowButtonVisibility(true); // restore traffic lights for the full window
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
    win.setContentProtection(false);
    if (savedMinSize) win.setMinimumSize(savedMinSize[0], savedMinSize[1]);
    if (wasMaximized) win.maximize();
    else if (savedBounds) win.setBounds(savedBounds);
    if (!win.isVisible()) win.show();
    win.focus();
  }
  active = false;
  collapsed = false;
  expanded = false;
  savedBounds = null;
  savedMinSize = null;
  wasMaximized = false;
}

export function isPresenterActive(): boolean {
  return active;
}
