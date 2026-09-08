import { describe, expect, it } from "vitest";
import { captureScale } from "./report-card-modal";
import { REPORT_CARD_WIDTH } from "./report-card-design";

/**
 * The download used to ask for a flat 2× regardless of how long the report was. Past the
 * browser's canvas ceiling that silently returns a blank or downscaled bitmap — which is what a
 * long report looked like when it came out pixelated. The multiplier now has to answer for the
 * card's real height.
 */
describe("captureScale", () => {
  const W = REPORT_CARD_WIDTH;

  it("keeps the crisp 2x for a card that comfortably fits", () => {
    // A trial report — a header, four facts and two lines.
    expect(captureScale(W, 1400)).toBe(2);
    // Still 2x at 3.4k tall: 2160 x 6800 is 14.7Mpx, inside the budget.
    expect(captureScale(W, 3400)).toBe(2);
  });

  it("steps down rather than overflowing the canvas on a long report", () => {
    const scale = captureScale(W, 6000);
    expect(scale).toBeLessThan(2);
    expect(scale).toBeGreaterThan(1);
    // Whatever it picks, the bitmap has to fit the budget the browsers actually enforce.
    expect(W * scale * 6000 * scale).toBeLessThanOrEqual(16_000_000);
  });

  it("never drops below 1x, however long the report runs", () => {
    // A card would have to pass 14,800px for even 1x to exceed the budget. Downscaling below the
    // card's own size would make the text worse than the bug being fixed.
    expect(captureScale(W, 40_000)).toBe(1);
  });
});
