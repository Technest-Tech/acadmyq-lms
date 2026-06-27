/**
 * Pure geometry for the composite Picture-in-Picture canvas (framework-free → Vitest-able). The PiP
 * window shows ALL participants Zoom-style, so we tile them into a near-square grid and cover-fit each
 * video into its cell.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Grid cell rects for `n` tiles in a `W`×`H` canvas (cols = ceil(sqrt(n)), rows fill top-to-bottom). */
export function pipCells(n: number, W: number, H: number): Rect[] {
  if (n <= 0 || W <= 0 || H <= 0) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = W / cols;
  const h = H / rows;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h });
  }
  return out;
}

/** Source crop rect to cover-fit (center-crop) a `srcW`×`srcH` frame into a `dstW`×`dstH` box. */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(srcW, 0), sh: Math.max(srcH, 0) };
  }
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  if (srcRatio > dstRatio) {
    const sw = srcH * dstRatio; // source wider → crop the sides
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / dstRatio; // source taller → crop top/bottom
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}
