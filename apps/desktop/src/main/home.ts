import { join } from "node:path";
import { BrowserWindow } from "electron";
import { TARGET_URL, TRUSTED_ORIGIN } from "./env";

/**
 * Meeting-only navigation. This app is NOT the AcademIQ web app — it opens to a native "Join a
 * meeting" screen and only ever shows a meeting (`/r/*`) or the host sign-in (`/login`). A guard
 * bounces every other web route (landing, dashboard, the whole management system) back to home, so
 * the SaaS chrome can never appear inside the app.
 */
const RENDERER_URL = process.env["ELECTRON_RENDERER_URL"];

export function loadHome(win: BrowserWindow): void {
  if (RENDERER_URL) void win.loadURL(`${RENDERER_URL}/home/index.html`);
  else void win.loadFile(join(__dirname, "../renderer/home/index.html"));
}

export function loadMeeting(win: BrowserWindow, rawInput: string): void {
  const url = resolveMeetingUrl(rawInput);
  if (url) void win.loadURL(url);
}

export function loadSignIn(win: BrowserWindow): void {
  void win.loadURL(`${base()}/login`);
}

function base(): string {
  return TARGET_URL.replace(/\/+$/, "");
}

/** A meeting link (…/r/<code>) or a bare code → the chrome-free meeting URL on the configured origin. */
export function resolveMeetingUrl(rawInput: string): string | null {
  const s = rawInput.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const i = u.pathname.indexOf("/r/");
    if (i >= 0) return `${base()}${u.pathname.slice(i)}${u.search}`;
  } catch {
    // not a URL — treat it as a bare meeting code below
  }
  const code = s.replace(/^\/+/, "").replace(/\s+/g, "");
  return code ? `${base()}/r/${encodeURIComponent(code)}` : null;
}

export function installNavGuard(win: BrowserWindow): void {
  const enforce = (rawUrl: string) => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return;
    }
    if (u.origin !== TRUSTED_ORIGIN) return; // the native home screen / dev renderer — always allowed
    const p = u.pathname;
    const allowed = p.startsWith("/r/") || p === "/login" || p.startsWith("/login/");
    if (!allowed) loadHome(win); // e.g. the post-login redirect to /dashboard → back to Join
  };
  win.webContents.on("did-navigate", (_e, url) => enforce(url));
  win.webContents.on("did-navigate-in-page", (_e, url) => enforce(url));
}
