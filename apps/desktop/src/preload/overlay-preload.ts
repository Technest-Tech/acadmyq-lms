import { contextBridge, ipcRenderer } from "electron";

/** Display metadata pushed from main so the overlay can show a resolution/DPR readout. */
export interface OverlayMeta {
  scaleFactor: number;
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number };
}

/** The drawing tool + style the overlay should author with, pushed from main when the teacher picks a
 * tool in the toolbar. `tool: "select"` means the overlay is click-through (the teacher uses their PC);
 * any drawing tool means the overlay captures the pointer and authors strokes. */
export interface OverlayTool {
  tool: "select" | "pen" | "line" | "arrow" | "rectangle" | "ellipse" | "eraser";
  color: string;
  width: number;
}

/**
 * Bridge for the overlay renderer. It PAINTS the room's annotation scene (receive-only for remote
 * marks) and — new in Phase 5 — also AUTHORS the teacher's own strokes when a drawing tool is active,
 * sending them back to main, which relays them to the web call client (the overlay has no LiveKit
 * connection of its own). Keep in sync with src/renderer/overlay/overlay.ts.
 */
contextBridge.exposeInMainWorld("academiqOverlay", {
  onMeta(cb: (meta: OverlayMeta) => void): () => void {
    const handler = (_e: unknown, meta: OverlayMeta) => cb(meta);
    ipcRenderer.on("overlay:meta", handler);
    return () => ipcRenderer.removeListener("overlay:meta", handler);
  },
  onScene(cb: (elements: unknown[]) => void): () => void {
    const handler = (_e: unknown, elements: unknown[]) => cb(elements);
    ipcRenderer.on("overlay:scene", handler);
    return () => ipcRenderer.removeListener("overlay:scene", handler);
  },
  onTool(cb: (tool: OverlayTool) => void): () => void {
    const handler = (_e: unknown, tool: OverlayTool) => cb(tool);
    ipcRenderer.on("overlay:tool", handler);
    return () => ipcRenderer.removeListener("overlay:tool", handler);
  },
  /** A toolbar command that the overlay performs against its authored marks (undo/redo). */
  onCommand(cb: (command: "undo" | "redo") => void): () => void {
    const handler = (_e: unknown, command: "undo" | "redo") => cb(command);
    ipcRenderer.on("overlay:command", handler);
    return () => ipcRenderer.removeListener("overlay:command", handler);
  },
  /** Send teacher-authored annotation elements (SHARE_W share-frame units) to main → web → students. */
  author(elements: unknown[]): void {
    ipcRenderer.send("overlay:author", elements);
  },
});
