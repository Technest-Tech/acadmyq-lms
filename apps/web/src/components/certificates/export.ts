import { CERT_HEIGHT, CERT_WIDTH } from "./kit";

/**
 * Turning a rendered certificate into a file. Everything here runs in the browser on the off-screen,
 * full-size capture node — the on-screen preview is scaled with a CSS transform and would capture
 * blurred.
 */

/** Let the fonts finish swapping and the latest render reach the DOM before a capture starts. */
export async function settleForCapture(): Promise<void> {
  await document.fonts?.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function captureCertificate(node: HTMLElement): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas-pro")).default;
  return html2canvas(node, {
    scale: 2,
    width: CERT_WIDTH,
    height: CERT_HEIGHT,
    windowWidth: CERT_WIDTH,
    windowHeight: CERT_HEIGHT,
    backgroundColor: "#FFFFFF",
    useCORS: true,
    logging: false,
  });
}

/** A landscape A4 document whose page box is the certificate's own pixel box. */
export async function createCertificatePdf() {
  const { jsPDF } = await import("jspdf");
  return new jsPDF({ orientation: "landscape", unit: "px", format: [CERT_WIDTH, CERT_HEIGHT], compress: true });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The certificate could not be encoded."))), type, quality),
  );
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously races the browser's read of the href.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function safeFileName(...parts: string[]): string {
  return (
    parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join("-")
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .slice(0, 120) || "certificate"
  );
}

/**
 * The certificate number for the n-th certificate of a batch: the trailing number in `start` counts
 * up and keeps its zero-padding ("2026-009" → "2026-010"). A start with no digits gets "-2", "-3"…
 * after the first; an empty start numbers nothing.
 */
export function serialAt(start: string, index: number): string {
  const trimmed = start.trim();
  if (!trimmed) return "";
  const match = /^(.*?)(\d+)(\D*)$/.exec(trimmed);
  if (!match) return index === 0 ? trimmed : `${trimmed}-${index + 1}`;
  const [, head = "", digits = "", tail = ""] = match;
  return `${head}${String(Number(digits) + index).padStart(digits.length, "0")}${tail}`;
}
