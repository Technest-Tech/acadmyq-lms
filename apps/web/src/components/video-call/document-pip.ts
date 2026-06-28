"use client";

/**
 * Thin wrapper around the **Document Picture-in-Picture API** (Chromium 116+). Unlike a canvas→native
 * PiP video, a Document-PiP window is a real, separate browser window we can render live DOM into —
 * actual `<video>` tiles (which keep decoding while the opener tab is backgrounded) AND interactive
 * controls. The opener's stylesheets don't carry over, so we clone them in. See
 * docs/video-platform/06-WEB-CALL-CLIENT.md. Not in the TS DOM lib yet → declared here.
 */

interface DocumentPictureInPictureApi {
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
  readonly window: Window | null;
  addEventListener(type: "enter", listener: (ev: Event) => void): void;
  removeEventListener(type: "enter", listener: (ev: Event) => void): void;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPictureApi;
  }
}

export function documentPipSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window &&
    !!window.documentPictureInPicture
  );
}

/** Open a Document-PiP window, clone the app's styles into it, and give it a dark, flush body. */
export async function openPipWindow(width: number, height: number): Promise<Window> {
  const win = await window.documentPictureInPicture!.requestWindow({ width, height });
  copyStyles(win);
  win.document.documentElement.style.colorScheme = "dark";
  win.document.body.style.margin = "0";
  win.document.body.style.background = "#0f172a"; // slate-900
  win.document.body.style.overflow = "hidden";
  return win;
}

/** Clone the opener's stylesheets so Tailwind classes render in the PiP window too. */
function copyStyles(win: Window): void {
  try {
    // Constructed/adopted sheets (Tailwind v4 may ship these).
    win.document.adoptedStyleSheets = [...document.adoptedStyleSheets];
  } catch {
    // Some sheets aren't adoptable across windows — the clones below still cover them.
  }
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    win.document.head.appendChild(node.cloneNode(true));
  });
}
