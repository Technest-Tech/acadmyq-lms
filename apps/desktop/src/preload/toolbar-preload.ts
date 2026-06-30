import { contextBridge, ipcRenderer } from "electron";

/** The tool + style the teacher picked in the floating annotation toolbar. */
export interface ToolbarTool {
  tool: "select" | "pen" | "line" | "arrow" | "rectangle" | "ellipse" | "eraser";
  color: string;
  width: number;
}

export type ToolbarAction = "undo" | "redo" | "clear" | "close";

/**
 * Bridge for the floating annotation toolbar (a small, content-protected window students never see).
 * It only SENDS — the renderer owns its own visual state. Main turns a tool pick into overlay
 * interactivity + an `overlay:tool` push, and routes actions (undo/redo to the overlay, clear/close to
 * the web call client). Keep in sync with src/renderer/toolbar/toolbar.ts.
 */
contextBridge.exposeInMainWorld("academiqToolbar", {
  setTool(tool: ToolbarTool): void {
    ipcRenderer.send("toolbar:tool", tool);
  },
  action(action: ToolbarAction): void {
    ipcRenderer.send("toolbar:action", action);
  },
});
