import { join } from "node:path";
import { BrowserWindow, screen, type Display } from "electron";

/**
 * The annotation overlay: ONE transparent, frameless, always-on-top, click-through window that we
 * reposition onto whichever display is being shared. It is deliberately NOT content-protected, so
 * the OS display-capture composites it into the shared stream (proven in the Phase 2 capture gate).
 *
 * Phase 3 still paints the debug grid (src/renderer/overlay) so placement is verifiable; Phase 4
 * swaps that for real annotation marks fed over IPC.
 */
let overlayWin: BrowserWindow | null = null;
// Latest annotation scene, kept so a freshly shown/created overlay paints immediately (no waiting
// for the next data-channel tick).
let lastScene: unknown[] = [];
const RENDERER_URL = process.env["ELECTRON_RENDERER_URL"];

function ensureOverlay(): BrowserWindow {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;

  const win = new BrowserWindow({
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // never steals focus from the app being annotated
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/overlay-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setIgnoreMouseEvents(true, { forward: true }); // click-through by default
  win.setAlwaysOnTop(true, "screen-saver"); // above normal windows
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // macOS: over fullscreen apps

  if (RENDERER_URL) void win.loadURL(`${RENDERER_URL}/overlay/index.html`);
  else void win.loadFile(join(__dirname, "../renderer/overlay/index.html"));

  win.on("closed", () => {
    overlayWin = null;
  });
  overlayWin = win;
  return win;
}

/** Place the overlay exactly over `display` (CSS/DIP bounds) and reveal it without stealing focus. */
export function showOverlayOnDisplay(display: Display): void {
  const win = ensureOverlay();
  const { x, y, width, height } = display.bounds;
  win.setBounds({ x, y, width, height });

  const sync = () => {
    win.webContents.send("overlay:meta", {
      scaleFactor: display.scaleFactor,
      width: display.size.width,
      height: display.size.height,
      bounds: display.bounds,
    });
    win.webContents.send("overlay:scene", lastScene);
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", sync);
  else sync();

  win.showInactive();
}

/** Relay the latest annotation scene to the overlay (if it exists); remembered for the next show. */
export function postSceneToOverlay(elements: unknown[]): void {
  lastScene = elements;
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const wc = overlayWin.webContents;
  if (wc.isLoading()) wc.once("did-finish-load", () => wc.send("overlay:scene", elements));
  else wc.send("overlay:scene", elements);
}

export function showOverlayOnPrimary(): void {
  showOverlayOnDisplay(screen.getPrimaryDisplay());
}

export function hideOverlay(): void {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
}

export function destroyOverlay(): void {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  overlayWin = null;
}

export function isOverlayVisible(): boolean {
  return !!overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible();
}

/**
 * Toggle whether the overlay swallows mouse input. Click-through (interactive=false) lets the
 * teacher keep using the book underneath; interactive=true is for when the teacher draws (Phase 5).
 */
export function setOverlayInteractive(interactive: boolean): void {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.setIgnoreMouseEvents(!interactive, { forward: true });
  overlayWin.setFocusable(interactive);
}
