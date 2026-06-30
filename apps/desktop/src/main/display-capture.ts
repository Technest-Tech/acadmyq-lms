import { desktopCapturer, session } from "electron";
import type { PickerItem } from "../preload/picker-preload";
import { isAnnotateArmed, setSharedDisplay } from "./overlay-controller";
import { openPicker } from "./source-picker";

/**
 * Routes the web client's `getDisplayMedia` (the existing screen-share button → LiveKit
 * `setScreenShareEnabled` → `getDisplayMedia`) through OUR native picker, then resolves it with the
 * chosen desktopCapturer source. Two jobs beyond "pick a source":
 *   1. when annotation is armed, offer **screens only** (V-DESK-1 — marks can't bake into a window-share);
 *   2. record the chosen screen's `display_id` so the overlay can lock onto exactly that display.
 */
export function installDisplayCaptureHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const screensOnly = isAnnotateArmed();
        const types: ("screen" | "window")[] = screensOnly
          ? ["screen"]
          : ["screen", "window"];

        const sources = await desktopCapturer.getSources({
          types,
          thumbnailSize: { width: 320, height: 200 },
          fetchWindowIcons: true,
        });

        const items: PickerItem[] = sources.map((s) => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.toDataURL(),
          kind: s.id.startsWith("screen:") ? "screen" : "window",
        }));

        const chosenId = await openPicker(items, { screensOnly });
        if (!chosenId) {
          // Cancelled — deny the request so getDisplayMedia rejects cleanly.
          callback({});
          return;
        }

        const source = sources.find((s) => s.id === chosenId);
        if (!source) {
          callback({});
          return;
        }

        // Record the shared display (only screen sources carry a display_id) for overlay placement.
        setSharedDisplay(source.display_id ? source.display_id : null);

        // System audio: Windows supports loopback; macOS does not via this path (best-effort → none).
        const audio = process.platform === "win32" ? "loopback" : undefined;
        callback(audio ? { video: source, audio } : { video: source });
      } catch {
        callback({});
      }
    },
    // Use our own picker UI, never the OS one.
    { useSystemPicker: false },
  );
}
