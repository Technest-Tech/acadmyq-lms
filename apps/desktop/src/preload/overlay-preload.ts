import { contextBridge, ipcRenderer } from "electron";

/** Display metadata pushed from main so the overlay can show a resolution/DPR readout. */
export interface OverlayMeta {
  scaleFactor: number;
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Bridge for the overlay renderer (receive-only — the overlay never authors anything, it just
 * paints the room's annotation scene). Keep in sync with src/renderer/overlay/overlay.ts.
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
});
