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
    /**
     * The meeting ended for this user (left / host-ended / removed) → return to the native lobby so
     * they can join another link. Optional: absent in older desktop builds.
     */
    returnToLobby?(): void;
    /**
     * Presenter mode — reshape the call window into a small, content-protected floating panel while
     * screen-sharing so the teacher can use their PC (students never see the panel). The web renders
     * its compact presenter layout in the same window. Optional: absent in older desktop builds.
     */
    enterPresenter?(): void;
    /**
     * Exit presenter mode — restore the call window and clear the annotation overlay. Safe even if
     * presenter mode was never entered (doubles as the share-stop overlay cleanup).
     */
    exitPresenter?(): void;
    /** Collapse the floating presenter panel into a small bubble. Optional. */
    collapsePresenter?(): void;
    /** Restore the bubble back to the full floating presenter panel. Optional. */
    expandPresenter?(): void;
    /** Grow/shrink the floating presenter window when a section (whiteboard or chat) opens/closes. Optional. */
    setPresenterExpanded?(on: boolean): void;
    /**
     * Subscribe to strokes the teacher authored on the interactive overlay (their own pen, Phase 5).
     * The web client injects them into the screen-annotation lane like a local stroke. Returns an
     * unsubscribe. Optional: absent in older desktop builds.
     */
    onScreenAnnotation?(cb: (elements: readonly unknown[]) => void): () => void;
    /**
     * Subscribe to toolbar control commands ("clear" wipes screen annotations; "off" = the toolbar
     * close button was pressed → flip the Annotate toggle off). Returns an unsubscribe. Optional.
     */
    onAnnotateControl?(cb: (command: "clear" | "off") => void): () => void;
  }

  interface Window {
    /** Present only inside the desktop app; `undefined` in every browser. */
    academiqDesktop?: AcademiqDesktopApi;
  }
}
