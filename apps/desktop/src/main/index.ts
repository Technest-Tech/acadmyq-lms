import { app, BrowserWindow, globalShortcut, session } from "electron";
import { TRUSTED_ORIGIN } from "./env";
import { deepLinkFromArgv, handleDeepLink, registerDeepLink } from "./deep-link";
import { installDisplayCaptureHandler } from "./display-capture";
import { registerIpc } from "./ipc";
import { initOverlayController, toggleAnnotate } from "./overlay-controller";
import { createMainWindow } from "./window-main";
import { destroyOverlay } from "./window-overlay";
import { destroyToolbar } from "./window-toolbar";
import { destroyShareIndicator } from "./window-share-indicator";

// Arm/disarm annotation. While armed the picker offers screens-only and the overlay rides the
// shared display. (A web control-bar button replaces this shortcut in Phase 5.)
const ANNOTATE_TOGGLE_ACCELERATOR = "CommandOrControl+Alt+G";

// Single-instance lock. Phase 1 needs it so a second launch focuses the existing window; Phase 6
// reuses it to route `academiq://room/{token}` deep-links into the running app.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // Windows delivers a deep link as an argv to the second launch; route it (and focus the window).
  app.on("second-instance", (_e, argv) => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    handleDeepLink(deepLinkFromArgv(argv));
  });

  // macOS delivers deep links via open-url (can fire before the window exists).
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  registerDeepLink();

  app.whenReady().then(() => {
    grantMediaToTrustedOrigin();
    registerIpc(); // annotation:scene (web bridge) → overlay; annotate:set → arm
    installDisplayCaptureHandler(); // route getDisplayMedia → our native picker
    initOverlayController(); // track shared display / annotate state for the overlay
    createMainWindow();
    globalShortcut.register(ANNOTATE_TOGGLE_ACCELERATOR, () => {
      toggleAnnotate();
    });
    // Cold start from a deep link (Windows: link is in argv).
    handleDeepLink(deepLinkFromArgv(process.argv));

    app.on("activate", () => {
      // macOS: re-create a window when the dock icon is clicked and none are open.
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    destroyOverlay();
    destroyToolbar();
    destroyShareIndicator();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

/**
 * Auto-grant camera/microphone/display-capture to OUR web origin only. Without this, the lobby
 * camera/mic preview is silently denied inside Electron (Chromium has no chrome:// permission UI
 * here). Any other origin is denied.
 */
function grantMediaToTrustedOrigin(): void {
  const mediaPermissions = new Set(["media", "display-capture", "mediaKeySystem"]);

  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const requesting = safeOrigin(wc?.getURL());
    callback(mediaPermissions.has(permission) && requesting === TRUSTED_ORIGIN);
  });

  // Some getUserMedia paths consult the synchronous check handler too.
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return mediaPermissions.has(permission) && requestingOrigin === TRUSTED_ORIGIN;
  });
}

function safeOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
