import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
import { getSharedDisplay } from "./overlay-controller";

/**
 * A single, unmistakable **"Exit drawing mode"** button that floats above the (pointer-capturing)
 * annotation overlay. While the teacher is drawing, every click on the shared screen becomes a stroke,
 * so the small side toolbar isn't an obvious escape — this gives a reliable, always-visible way out.
 *
 * Like the toolbar it is **content-protected** (students never see it in the capture) and sits ONE
 * level above the toolbar (`screen-saver` +3) so it's always on top of everything and stays clickable.
 * It reuses the toolbar preload/IPC: the button sends `action("close")`, which disarms annotation
 * (main `armAnnotate(false)`) and flips the web Annotate button off — the same path as the toolbar X.
 */
let win: BrowserWindow | null = null;

const W = 236;
const H = 52;
const TOP_MARGIN = 12;
const RENDERER_URL = process.env["ELECTRON_RENDERER_URL"];

/** Top-center of the shared display (or the cursor's display in dev). */
function bounds(): Electron.Rectangle {
  const display =
    getSharedDisplay() ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  return {
    x: Math.round(wa.x + (wa.width - W) / 2),
    y: Math.round(wa.y + TOP_MARGIN),
    width: W,
    height: H,
  };
}

function ensure(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;

  const w = new BrowserWindow({
    ...bounds(),
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

  w.setContentProtection(true); // students never see the button in the shared capture
  w.setAlwaysOnTop(true, "screen-saver", 3); // above the overlay AND the toolbar → always clickable
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (RENDERER_URL) void w.loadURL(`${RENDERER_URL}/exit-draw/index.html`);
  else void w.loadFile(join(__dirname, "../renderer/exit-draw/index.html"));

  w.on("closed", () => {
    win = null;
  });
  win = w;
  return w;
}

/** Show the exit button over the shared display (re-anchored each time). */
export function showExitDraw(): void {
  const w = ensure();
  w.setBounds(bounds());
  w.showInactive();
}

export function hideExitDraw(): void {
  if (win && !win.isDestroyed()) win.hide();
}

export function destroyExitDraw(): void {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
