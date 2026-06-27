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
