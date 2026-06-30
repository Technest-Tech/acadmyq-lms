import { contextBridge, ipcRenderer } from "electron";

/**
 * The desktop bridge exposed to the web call client as `window.academiqDesktop`. Its mere presence
 * is how the web app knows it's running inside the desktop app (`useIsDesktop()`); when absent
 * (every browser, every student) the web experience is byte-identical (V-DESK-3).
 *
 * Keep this contract in sync with apps/web/src/types/academiq-desktop.d.ts.
 */
const api = {
  isDesktop: true as const,
  platform: process.platform,
  version: __APP_VERSION__,
  /**
   * Forward the room's current annotation elements (Excalidraw-shaped, in SHARE_W share-frame
   * units) to the main process, which relays them to the overlay window for painting onto the
   * shared display. Called by the web client only when this teacher is the active screen-sharer.
   */
  pushAnnotationScene(elements: unknown[]): void {
    ipcRenderer.send("annotation:scene", elements);
  },
  /**
   * Arm/disarm annotation from the web control bar: arming makes the screen-share picker
   * screens-only and shows the overlay on the shared display (the global Ctrl/⌘+Alt+G does the same).
   */
  setAnnotateMode(on: boolean): void {
    ipcRenderer.send("annotate:set", !!on);
  },
  /**
   * Enter presenter mode — reshape the call window into a small, always-on-top, content-protected
   * floating panel so the teacher can use their PC while sharing (students never see the panel). The
   * web renders its desktop-only compact presenter layout in this same window.
   */
  enterPresenter(): void {
    ipcRenderer.send("presenter:enter");
  },
  /**
   * Exit presenter mode — restore the call window and tear down the annotation overlay. Safe to
   * call even if presenter mode was never entered (it doubles as the share-stop overlay cleanup).
   */
  exitPresenter(): void {
    ipcRenderer.send("presenter:exit");
  },
};

contextBridge.exposeInMainWorld("academiqDesktop", api);

/**
 * The native "Join a meeting" home screen's bridge (this is a MEETING-ONLY app — it never shows the
 * SaaS dashboard). Used by src/renderer/home.
 */
contextBridge.exposeInMainWorld("academiqHome", {
  join(input: string): void {
    ipcRenderer.send("home:join", input);
  },
  signIn(): void {
    ipcRenderer.send("home:signin");
  },
});

export type AcademiqDesktopApi = typeof api;
