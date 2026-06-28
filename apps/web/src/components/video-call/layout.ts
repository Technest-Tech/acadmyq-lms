/**
 * Pure layout selection for the call stage (kept framework-free so it's unit-testable — Vitest).
 *
 * - presenter: someone is screen-sharing → the shared screen dominates, people ride a filmstrip.
 * - spotlight: 1:1 (or alone) OR an explicit pin → one large focus tile + filmstrip / draggable PiP.
 * - grid: a small group → an adaptive grid.
 *
 * Precedence is screen-share > pin > count: shared content is what everyone needs to see, so it wins
 * even over a local pin; otherwise an explicit pin forces a spotlight regardless of the group size.
 */
export type CallLayout = "spotlight" | "grid" | "presenter";

export function selectLayout(
  participantCount: number,
  hasScreenShare: boolean,
  hasPin = false,
): CallLayout {
  if (hasScreenShare) return "presenter";
  if (hasPin) return "spotlight";
  if (participantCount <= 2) return "spotlight";
  return "grid";
}

/** Tailwind column classes for the grid layout, scaled to the participant count. */
export function gridColumns(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-2";
  if (count <= 9) return "grid-cols-2 sm:grid-cols-3";
  return "grid-cols-3 sm:grid-cols-4";
}

/**
 * The best {cols, rows} to tile `count` 16:9 cells into a `width`×`height` area so every tile is as
 * large as possible and they ALL fit on screen — the classic gallery solver (Meet/Zoom-style). Pure,
 * so it's unit-tested. Falls back to a square-ish grid when the area isn't measured yet (first paint).
 */
export function tileGrid(
  count: number,
  width: number,
  height: number,
  aspect = 16 / 9,
): { cols: number; rows: number } {
  const n = Math.max(1, Math.floor(count));
  if (!width || !height) {
    const cols = Math.ceil(Math.sqrt(n));
    return { cols, rows: Math.ceil(n / cols) };
  }

  let best = { cols: 1, rows: n, area: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = width / cols;
    const cellH = height / rows;
    // Largest 16:9 tile that fits this cell (letterboxed by whichever dimension binds).
    const tileW = Math.min(cellW, cellH * aspect);
    const area = tileW * (tileW / aspect);
    if (area > best.area) best = { cols, rows, area };
  }
  return { cols: best.cols, rows: best.rows };
}

/** Tile chrome density derived from a tile's rendered width (px) — drives avatar/text/control sizing. */
export type TileDensity = "normal" | "compact" | "tiny";

export function tileDensity(tileWidth: number): TileDensity {
  if (!tileWidth || tileWidth >= 250) return "normal";
  if (tileWidth >= 150) return "compact";
  return "tiny";
}
