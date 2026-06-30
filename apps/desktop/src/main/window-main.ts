import { join } from "node:path";
import { BrowserWindow, shell } from "electron";
import { installNavGuard, loadHome } from "./home";

/**
 * The single main window, tracked module-level so the main process can target IT specifically (e.g.
 * presenter mode hides/restores it) without guessing among the overlay/picker windows that
 * `BrowserWindow.getAllWindows()` also returns.
 */
let mainWin: BrowserWindow | null = null;

/** The main window, or null if it hasn't been created / has been destroyed. */
export function getMainWindow(): BrowserWindow | null {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null;
}

/**
 * The primary window. This is a MEETING-ONLY app: it opens on a native "Join a meeting" screen and
 * only ever shows a chrome-free meeting (`/r/*`) or the host sign-in — never the AcademIQ dashboard
 * (a nav guard enforces this). The meeting itself is the real web call UI, reused as-is; native
 * capabilities (annotation overlay, source picker) ride the preload bridge.
 *
 * Security posture (kept for every window we ever create): contextIsolation ON, nodeIntegration
 * OFF, sandbox ON, webSecurity ON. The preload is the only privileged surface.
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0f172a", // matches the call client's slate-900 shell — no white flash
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Avoid a blank/white flash: reveal only once the page is painted.
  win.once("ready-to-show", () => win.show());

  // External links (anything that would open a new window/tab) go to the system browser, never a
  // second Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWin = win;
  win.on("closed", () => {
    if (mainWin === win) mainWin = null;
  });

  installNavGuard(win); // keep the window to home / meetings / sign-in only
  loadHome(win); // open on the native "Join a meeting" screen
  return win;
}
