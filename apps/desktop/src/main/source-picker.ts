import { join } from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import type { PickerItem } from "../preload/picker-preload";

/**
 * Our OWN screen-share source picker. Electron's `setDisplayMediaRequestHandler` intercepts
 * `getDisplayMedia` but provides NO picker UI — we render this one and resolve the user's choice
 * back to the handler. A single picker is shown at a time.
 */
let pickerWin: BrowserWindow | null = null;
let pending: ((id: string | null) => void) | null = null;

const RENDERER_URL = process.env["ELECTRON_RENDERER_URL"];

export function openPicker(
  items: PickerItem[],
  opts: { screensOnly: boolean },
): Promise<string | null> {
  // A new request supersedes any open picker.
  cleanup(null);

  return new Promise((resolve) => {
    pending = resolve;

    const win = new BrowserWindow({
      width: 820,
      height: 600,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      show: false,
      alwaysOnTop: true,
      backgroundColor: "#0b1120",
      title: "Choose what to share",
      webPreferences: {
        preload: join(__dirname, "../preload/picker-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    pickerWin = win;

    win.once("ready-to-show", () => {
      win.webContents.send("picker:payload", { items, screensOnly: opts.screensOnly });
      win.show();
    });

    // Closing the window with no choice (e.g. Esc / OS close) counts as cancel.
    win.on("closed", () => {
      pickerWin = null;
      if (pending) {
        pending(null);
        pending = null;
      }
    });

    if (RENDERER_URL) void win.loadURL(`${RENDERER_URL}/picker/index.html`);
    else void win.loadFile(join(__dirname, "../renderer/picker/index.html"));
  });
}

// Picker renderer → main: the user's choice (source id, or null to cancel).
ipcMain.on("picker:choose", (_e, id: string | null) => {
  cleanup(id);
});

function cleanup(id: string | null): void {
  const resolve = pending;
  pending = null;
  if (pickerWin && !pickerWin.isDestroyed()) {
    pickerWin.removeAllListeners("closed"); // avoid the closed-handler firing a second resolve
    pickerWin.close();
  }
  pickerWin = null;
  if (resolve) resolve(id);
}
