// Pure coordinate math for screen-share annotation — the desktop twin of the web authoring side.
//
// Marks are authored in a fixed "share frame": SHARE_W scene units wide × SHARE_W*(displayH/displayW)
// tall (the shared display's aspect ratio). Every client maps this frame onto its own pixels, so a
// mark at share-(x,y) lands at the same fraction of the shared screen everywhere — exactly the trick
// `pageBounds`/`DOC_PAGE_WIDTH` uses for PDF pages (whiteboard-protocol.ts).
//
// Because the overlay canvas spans the WHOLE shared display and the share frame has the display's
// aspect ratio, a single UNIFORM scale maps share units → CSS px (x and y scale identically). HiDPI
// is handled separately by the canvas backing-store (devicePixelRatio), kept out of this math.

export const SHARE_W = 1000;

/** Height of the share frame in scene units for a display of the given pixel size. */
export function shareFrameHeight(displayW: number, displayH: number): number {
  return displayW > 0 ? (SHARE_W * displayH) / displayW : SHARE_W;
}

/** Uniform scene→CSS-px scale for a canvas whose CSS width spans the whole shared display. */
export function shareScale(canvasCssWidth: number): number {
  return canvasCssWidth / SHARE_W;
}
