import { BrowserWindow, ipcMain } from "electron";
import { loadMeeting, loadSignIn } from "./home";
import { armAnnotate, setTool, type AnnotationTool } from "./overlay-controller";
import {
  collapsePresenter,
  enterPresenter,
  exitPresenter,
  expandPresenter,
} from "./presenter-controller";
import { getMainWindow } from "./window-main";
import { postCommandToOverlay, postSceneToOverlay } from "./window-overlay";

/** Relay a message to the web call client (the main window), which has the LiveKit connection. */
function toWeb(channel: string, payload?: unknown): void {
  const win = getMainWindow();
  if (win) win.webContents.send(channel, payload);
}

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
  // The floating toolbar (a content-protected window) drives the teacher's own pen.
  ipcMain.on("toolbar:tool", (_e, tool: unknown) => {
    if (isTool(tool)) setTool(tool);
  });
  ipcMain.on("toolbar:action", (_e, action: unknown) => {
    switch (action) {
      case "undo":
      case "redo":
        postCommandToOverlay(action); // the overlay performs it against its authored marks
        break;
      case "clear":
        toWeb("desktop:annotate-control", "clear"); // web clears the sa-lane (host-gated + broadcast)
        break;
      case "close":
        armAnnotate(false); // hide overlay + toolbar, drop interactivity
        toWeb("desktop:annotate-control", "off"); // web flips the Annotate button off (+ baking off)
        break;
    }
  });
  // The interactive overlay authored a stroke — relay it to the web client to inject into the sa-lane
  // (the overlay has no LiveKit connection of its own).
  ipcMain.on("overlay:author", (_e, elements: unknown) => {
    toWeb("desktop:annotate-author", Array.isArray(elements) ? elements : []);
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
  ipcMain.on("presenter:collapse", () => {
    collapsePresenter();
  });
  ipcMain.on("presenter:expand", () => {
    expandPresenter();
  });
}

const TOOL_KINDS = new Set(["select", "pen", "line", "arrow", "rectangle", "ellipse", "eraser"]);

function isTool(v: unknown): v is AnnotationTool {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    TOOL_KINDS.has(t["tool"] as string) &&
    typeof t["color"] === "string" &&
    typeof t["width"] === "number"
  );
}
