import { app, BrowserWindow } from "electron";
import { TARGET_URL } from "./env";

/**
 * Deep-linking: `academiq://room/<join_token>` launches/focuses the app straight into that room's
 * public join page (`/r/<token>` on the web client — the same link the browser uses). Registration +
 * routing only; the web `/r/[token]` flow is unchanged.
 */
const SCHEME = "academiq";

export function registerDeepLink(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    // dev (running `electron .`) — register with the script path so Windows can re-invoke us.
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [process.argv[1] ?? ""]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }
}

/** Pull the first `academiq://…` argument out of an argv (Windows delivers the link this way). */
export function deepLinkFromArgv(argv: readonly string[]): string | undefined {
  return argv.find((a) => a.startsWith(`${SCHEME}://`));
}

/** Route a deep link into the running app: focus the window and load the room's join page. */
export function handleDeepLink(url: string | undefined): void {
  const token = parseRoomToken(url);
  if (!token) return;
  const target = `${TARGET_URL.replace(/\/+$/, "")}/r/${encodeURIComponent(token)}`;
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  void win.loadURL(target);
}

function parseRoomToken(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== `${SCHEME}:` || u.hostname !== "room") return null;
    const token = u.pathname.replace(/^\/+/, "");
    return token || null;
  } catch {
    return null;
  }
}
