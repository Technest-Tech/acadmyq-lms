import { join } from "node:path";
import { BrowserWindow, type Display } from "electron";

/**
 * The Zoom-style "you're sharing your screen" indicator: a transparent, click-through, always-on-top
 * window that draws a pulsing green frame around the shared display while the teacher screen-shares.
 *
 * It is **content-protected** (excluded from the OS screen capture, like the toolbar/presenter panel),
 * so only the teacher sees the frame — students never get a green border baked into their video. It is
 * click-through (`setIgnoreMouseEvents`) so it never blocks the screen, and covers the whole display
 * (`enableLargerThanScreen`) so the frame hugs the true screen edges including the macOS menu bar.
 */
let win: BrowserWindow | null = null;

const RENDERER_URL = process.env["ELECTRON_RENDERER_URL"];

function ensure(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
  const w = new BrowserWindow({
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
    focusable: false,
    enableLargerThanScreen: true,
    backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.setIgnoreMouseEvents(true, { forward: true }); // never blocks the shared screen
  w.setContentProtection(true); // students never see the frame in the capture
  w.setAlwaysOnTop(true, "screen-saver");
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (RENDERER_URL) void w.loadURL(`${RENDERER_URL}/share-indicator/index.html`);
  else void w.loadFile(join(__dirname, "../renderer/share-indicator/index.html"));
  w.on("closed", () => {
    win = null;
  });
  win = w;
  return w;
}

/** Show the green sharing frame over `display`. */
export function showShareIndicator(display: Display): void {
  const w = ensure();
  const { x, y, width, height } = display.bounds;
  w.setBounds({ x, y, width, height });
  w.showInactive();
}

export function hideShareIndicator(): void {
  if (win && !win.isDestroyed()) win.hide();
}

export function destroyShareIndicator(): void {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
