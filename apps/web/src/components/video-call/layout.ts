/**
 * Pure layout selection for the call stage (kept framework-free so it's unit-testable — Vitest).
 *
 * - presenter: someone is screen-sharing → the shared screen dominates, people ride a filmstrip.
 * - spotlight: 1:1 (or alone) → one large focus tile + a draggable self-PiP.
 * - grid: a small group → an adaptive grid.
 */
export type CallLayout = "spotlight" | "grid" | "presenter";

export function selectLayout(participantCount: number, hasScreenShare: boolean): CallLayout {
  if (hasScreenShare) return "presenter";
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
