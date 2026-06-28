"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Host-only PDF rasteriser. ONLY the teacher opening a document runs pdf.js — each page is rendered to
 * a compressed JPEG and broadcast to the room, so a student's phone never loads a PDF engine or does the
 * heavy work; it just decodes one image. pdf.js is dynamically imported (and its worker pinned to the
 * matching version) so it stays out of the main call bundle until a host actually opens a document. See
 * docs/video-platform/09-WHITEBOARD-AND-ANNOTATION.md.
 */

type PdfjsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      // The worker must match the library version exactly; serve it from the CDN (a host-side,
      // online-only concern — self-host alongside the Excalidraw fonts as a later hardening step).
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export interface RenderedPage {
  /** A `data:image/jpeg;base64,…` URL of the rasterised page. */
  dataURL: string;
  naturalW: number;
  naturalH: number;
  mimeType: string;
}

/** Load a PDF File into a pdf.js document (host only). Throws if the file isn't a readable PDF. */
export async function loadPdf(file: File): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  const data = await file.arrayBuffer();
  return pdfjs.getDocument({ data }).promise;
}

/**
 * Rasterise one page to a compressed JPEG sized for sharing — the longest side is capped (cheap to
 * encode + send over the data channel) and a white backing is painted first (PDFs may be transparent).
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  page: number,
  maxEdge = 1600,
  quality = 0.72,
): Promise<RenderedPage> {
  const p = await doc.getPage(page);
  const base = p.getViewport({ scale: 1 });
  const scale = Math.min(maxEdge / Math.max(base.width, base.height), 2);
  const viewport = p.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await p.render({ canvas, canvasContext: ctx, viewport }).promise;

  const mimeType = "image/jpeg";
  return { dataURL: canvas.toDataURL(mimeType, quality), naturalW: canvas.width, naturalH: canvas.height, mimeType };
}
