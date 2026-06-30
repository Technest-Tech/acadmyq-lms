import { BrowserWindow, ipcMain } from "electron";
import { loadMeeting, loadSignIn } from "./home";
import { armAnnotate } from "./overlay-controller";
import { enterPresenter, exitPresenter } from "./presenter-controller";
import { postSceneToOverlay } from "./window-overlay";

/**
 * Single registry for IPC the main process listens to: the native home screen (join / sign-in), the
 * web client's annotation-scene forward (relayed to the overlay), the web annotate toggle, and the
 * presenter-mode window choreography (hide/restore the call window on share start/stop).
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
  // Presenter mode: the web calls these from inside the desktop app only. enter is sent AFTER the
  // floating panel is open (so the teacher is never left with no controls); exit also clears a
  // stuck annotation overlay. Inert in a browser (the bridge methods don't exist there).
  ipcMain.on("presenter:enter", () => {
    enterPresenter();
  });
  ipcMain.on("presenter:exit", () => {
    exitPresenter();
  });
}
