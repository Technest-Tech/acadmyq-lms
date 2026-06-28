import { describe, expect, it } from "vitest";
import { coverCrop, gridDims, pipCells } from "./pip-layout";

describe("gridDims", () => {
  it("is empty for no tiles", () => {
    expect(gridDims(0)).toEqual({ cols: 0, rows: 0 });
  });
  it("packs into a near-square grid (cols = ceil(√n))", () => {
    expect(gridDims(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridDims(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridDims(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridDims(5)).toEqual({ cols: 3, rows: 2 });
    expect(gridDims(9)).toEqual({ cols: 3, rows: 3 });
    expect(gridDims(20)).toEqual({ cols: 5, rows: 4 });
  });
});

describe("pipCells", () => {
  it("returns nothing for an empty scene", () => {
    expect(pipCells(0, 480, 360)).toEqual([]);
  });

  it("gives one full-canvas cell for a single tile", () => {
    expect(pipCells(1, 480, 360)).toEqual([{ x: 0, y: 0, w: 480, h: 360 }]);
  });

  it("splits two tiles side by side", () => {
    const cells = pipCells(2, 480, 360);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 240, h: 360 });
    expect(cells[1]).toEqual({ x: 240, y: 0, w: 240, h: 360 });
  });

  it("uses a 2x2 grid for three or four tiles", () => {
    expect(pipCells(4, 480, 360)).toHaveLength(4);
    const three = pipCells(3, 480, 360);
    expect(three).toHaveLength(3);
    // cols=2 rows=2 → 240x180 cells, third drops to the second row
    expect(three[2]).toEqual({ x: 0, y: 180, w: 240, h: 180 });
  });
});

describe("coverCrop", () => {
  it("crops the sides of a source wider than the box", () => {
    // 16:9 source into a 4:3 box → crop left/right, full height
    const c = coverCrop(1280, 720, 480, 360);
    expect(c.sy).toBe(0);
    expect(c.sh).toBe(720);
    expect(c.sw).toBeCloseTo(960); // 720 * (480/360)
    expect(c.sx).toBeCloseTo(160);
  });

  it("crops the top/bottom of a source taller than the box", () => {
    // 3:4 source into a 4:3 box → crop top/bottom, full width
    const c = coverCrop(360, 480, 480, 360);
    expect(c.sx).toBe(0);
    expect(c.sw).toBe(360);
    expect(c.sh).toBeCloseTo(270); // 360 / (480/360)
    expect(c.sy).toBeCloseTo(105);
  });

  it("is a no-op for a zero-sized source", () => {
    expect(coverCrop(0, 0, 480, 360)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});
