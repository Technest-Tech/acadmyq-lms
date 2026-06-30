import { BrowserWindow, ipcMain } from "electron";
import { loadMeeting, loadSignIn } from "./home";
import { armAnnotate } from "./overlay-controller";
import { postSceneToOverlay } from "./window-overlay";

/**
 * Single registry for IPC the main process listens to: the native home screen (join / sign-in), the
 * web client's annotation-scene forward (relayed to the overlay), and the web annotate toggle.
 */
export function registerIpc(): void {
  ipcMain.on("home:join", (e, input: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && typeof input === "string") loadMeeting(win, input);
  });
  ipcMain.on("home:signin", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) loadSignIn(win);
  });
  ipcMain.on("annotation:scene", (_e, elements: unknown) => {
    postSceneToOverlay(Array.isArray(elements) ? elements : []);
  });
  ipcMain.on("annotate:set", (_e, on: unknown) => {
    armAnnotate(!!on);
  });
}
