"use client";

/**
 * ⏸️ TEMPORARY STUB — PDF import is withheld from this build.
 *
 * The real pdf.js rasteriser (host-only: renders each page to a JPEG and broadcasts it) was removed here
 * ONLY to drop the `pdfjs-dist` dependency, which the repo's supply-chain release-age policy blocked at
 * deploy time (the published version was <24h old). The whiteboard's drawing/annotation is unaffected, and
 * the PDF UI is already hidden behind `SHOW_PDF = false` in whiteboard-panel.tsx — so these functions are
 * never invoked in this build.
 *
 * TO RESTORE (once pdfjs-dist clears the age policy):
 *   1. git show 7af85f7:apps/web/src/components/video-call/whiteboard-pdf.ts > <this file>
 *   2. re-add "pdfjs-dist" to apps/web/package.json + pnpm install
 *   3. flip SHOW_PDF = true in whiteboard-panel.tsx
 * See docs/video-platform/09-WHITEBOARD-AND-ANNOTATION.md.
 */

/** Minimal shape the whiteboard needs from a loaded document (kept so consumers type-check unchanged). */
export interface LoadedPdf {
  numPages: number;
}

export interface RenderedPage {
  /** A `data:image/jpeg;base64,…` URL of the rasterised page. */
  dataURL: string;
  naturalW: number;
  naturalH: number;
  mimeType: string;
}

const PDF_DISABLED = "PDF import is temporarily unavailable in this build.";

/** Disabled in this build — see the file header. */
export async function loadPdf(_file: File): Promise<LoadedPdf> {
  throw new Error(PDF_DISABLED);
}

/** Disabled in this build — see the file header. */
export async function renderPage(
  _doc: LoadedPdf,
  _page: number,
  _maxEdge = 1600,
  _quality = 0.72,
): Promise<RenderedPage> {
  throw new Error(PDF_DISABLED);
}
