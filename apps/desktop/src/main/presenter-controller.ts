import { screen } from "electron";
import { armAnnotate, clearShare, getSharedDisplay } from "./overlay-controller";
import { getMainWindow } from "./window-main";
import { hideOverlay, postSceneToOverlay } from "./window-overlay";

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
const PANEL_W = 420;
const PANEL_H = 340;
const MARGIN = 16;

let active = false;
let savedBounds: Electron.Rectangle | null = null;
let savedMinSize: [number, number] | null = null;
let wasMaximized = false;

/** Anchor the panel to the top-trailing (right) corner of the shared display (or the cursor's). */
function panelBounds(): Electron.Rectangle {
  const display =
    getSharedDisplay() ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea; // respects menu bar / taskbar
  return {
    x: Math.round(wa.x + wa.width - PANEL_W - MARGIN),
    y: Math.round(wa.y + MARGIN),
    width: PANEL_W,
    height: PANEL_H,
  };
}

/** Reshape + content-protect the call window into the floating presenter panel. */
export function enterPresenter(): void {
  const win = getMainWindow();
  if (!win || active) return;
  active = true;
  wasMaximized = win.isMaximized();
  savedBounds = win.getBounds();
  savedMinSize = win.getMinimumSize() as [number, number];

  if (wasMaximized) win.unmaximize();
  win.setContentProtection(true); // exclude the panel from the shared-screen capture
  win.setMinimumSize(300, 220); // allow the small panel (normal min is 960×600)
  win.setBounds(panelBounds());
  win.setAlwaysOnTop(true, "screen-saver"); // float above the teacher's other apps
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

/** Restore the call window and tear down the annotation overlay (also the stuck-overlay bug fix). */
export function exitPresenter(): void {
  // Overlay teardown — runs unconditionally so a stuck overlay can never survive share-stop, even if
  // enterPresenter never ran (e.g. a stale armed state, or a window share with no presenter reshape).
  armAnnotate(false); // reconcile() → hideOverlay() since no longer armed
  clearShare(); // forget the shared display
  postSceneToOverlay([]); // drop the remembered scene so a later share can't repaint stale marks
  hideOverlay(); // belt-and-suspenders

  const win = getMainWindow();
  // Reset the web Annotate toggle + baking flag so a stopped share never leaves a stale "on" button
  // (the overlay/toolbar are already torn down above). Harmless on a plain leave/unmount.
  win?.webContents.send("desktop:annotate-control", "off");

  if (win && active) {
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
  savedBounds = null;
  savedMinSize = null;
  wasMaximized = false;
}

export function isPresenterActive(): boolean {
  return active;
}
