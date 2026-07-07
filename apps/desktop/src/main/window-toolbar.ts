import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
import { getSharedDisplay } from "./overlay-controller";

/**
 * The floating annotation toolbar window — the teacher's tool/colour/width picker while annotating.
 *
 * Crucially it is **content-protected** (`setContentProtection(true)`): the OS excludes it from screen
 * capture, so students never see the toolbar even though it floats over the shared display (the same
 * trick presenter mode uses for the call panel). It sits ABOVE the (possibly interactive) annotation
 * overlay at a higher always-on-top level so it stays clickable while the teacher draws.
 */
let toolbarWin: BrowserWindow | null = null;

const TOOLBAR_W = 60;
const TOOLBAR_H = 560;
const MARGIN = 18;

const RENDERER_URL = process.env["ELECTRON_RENDERER_URL"];

/** Left-center of the shared display (or the cursor's display in dev), clamped to its work area. */
function toolbarBounds(): Electron.Rectangle {
  const display =
    getSharedDisplay() ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const height = Math.min(TOOLBAR_H, wa.height - 2 * MARGIN);
  return {
    x: Math.round(wa.x + MARGIN),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width: TOOLBAR_W,
    height,
  };
}

function ensureToolbar(): BrowserWindow {
  if (toolbarWin && !toolbarWin.isDestroyed()) return toolbarWin;

  const win = new BrowserWindow({
    ...toolbarBounds(),
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/toolbar-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setContentProtection(true); // students never see the toolbar in the shared capture
  // One level above the overlay's "screen-saver" so it stays clickable even when the overlay is
  // interactive (full-display pointer capture).
  win.setAlwaysOnTop(true, "screen-saver", 2);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (RENDERER_URL) void win.loadURL(`${RENDERER_URL}/toolbar/index.html`);
  else void win.loadFile(join(__dirname, "../renderer/toolbar/index.html"));

  win.on("closed", () => {
    toolbarWin = null;
  });
  toolbarWin = win;
  return win;
}

/** Show the toolbar over the shared display (re-anchored each time). */
export function showToolbar(): void {
  const win = ensureToolbar();
  win.setBounds(toolbarBounds());
  win.showInactive();
}

export function hideToolbar(): void {
  if (toolbarWin && !toolbarWin.isDestroyed()) toolbarWin.hide();
}

/** The toolbar's on-screen rect while it's visible (for the overlay's hover pass-through), else null. */
export function getToolbarBounds(): Electron.Rectangle | null {
  if (toolbarWin && !toolbarWin.isDestroyed() && toolbarWin.isVisible()) return toolbarWin.getBounds();
  return null;
}

export function destroyToolbar(): void {
  if (toolbarWin && !toolbarWin.isDestroyed()) toolbarWin.destroy();
  toolbarWin = null;
}
