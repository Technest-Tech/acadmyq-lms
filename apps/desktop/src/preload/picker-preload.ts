import { contextBridge, ipcRenderer } from "electron";

/** One selectable capture source shown in the picker. */
export interface PickerItem {
  id: string;
  name: string;
  thumbnail: string; // data URL
  kind: "screen" | "window";
}

export interface PickerPayload {
  items: PickerItem[];
  /** When true, annotation is armed → only screens are offered (V-DESK-1). */
  screensOnly: boolean;
}

/** Bridge for the source-picker renderer. Keep in sync with src/renderer/picker/picker.ts. */
contextBridge.exposeInMainWorld("academiqPicker", {
  onPayload(cb: (payload: PickerPayload) => void): () => void {
    const handler = (_e: unknown, payload: PickerPayload) => cb(payload);
    ipcRenderer.on("picker:payload", handler);
    return () => ipcRenderer.removeListener("picker:payload", handler);
  },
  choose(id: string): void {
    ipcRenderer.send("picker:choose", id);
  },
  cancel(): void {
    ipcRenderer.send("picker:choose", null);
  },
});
