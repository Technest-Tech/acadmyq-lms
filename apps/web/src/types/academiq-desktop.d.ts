// Type for the bridge injected by the AcademIQ Teacher desktop app (apps/desktop) via its preload.
// It is ABSENT in the browser (students + browser teachers), so it is optional on `window` and all
// desktop-only behavior must guard on it. Keep in sync with
// apps/desktop/src/preload/index.ts.

export {};

declare global {
  interface AcademiqDesktopApi {
    /** Always true when present — the feature-detect flag (see `useIsDesktop`). */
    readonly isDesktop: true;
    /** Node `process.platform` of the host machine ("win32" | "darwin" | "linux"). */
    readonly platform: string;
    /** Desktop app version (from apps/desktop/package.json). */
    readonly version: string;
    /**
     * Forward the room's screen-share annotation elements (Excalidraw-shaped, in SHARE_W share-frame
     * units) to the overlay window, which paints them onto the shared display so they bake into the
     * stream. Called only on the teacher's desktop app.
     */
    pushAnnotationScene(elements: readonly unknown[]): void;
    /** Arm/disarm annotation (overlay visibility + screens-only picker). Added in Phase 5. */
    setAnnotateMode?(on: boolean): void;
  }

  interface Window {
    /** Present only inside the desktop app; `undefined` in every browser. */
    academiqDesktop?: AcademiqDesktopApi;
  }
}
