import { describe, expect, it } from "vitest";
import { roomShareUrl } from "@/lib/api";
import { gridColumns, selectLayout, tileDensity, tileGrid } from "./layout";
import { nextPinned } from "./pin-context";

describe("selectLayout", () => {
  it("uses spotlight when alone or 1:1", () => {
    expect(selectLayout(1, false)).toBe("spotlight");
    expect(selectLayout(2, false)).toBe("spotlight");
  });

  it("uses a grid for a small group", () => {
    expect(selectLayout(3, false)).toBe("grid");
    expect(selectLayout(6, false)).toBe("grid");
  });

  it("always uses presenter when someone is screen-sharing", () => {
    expect(selectLayout(1, true)).toBe("presenter");
    expect(selectLayout(2, true)).toBe("presenter");
    expect(selectLayout(8, true)).toBe("presenter");
  });

  it("forces spotlight when a participant is pinned, even in a group", () => {
    expect(selectLayout(5, false, true)).toBe("spotlight");
    expect(selectLayout(3, false, true)).toBe("spotlight");
  });

  it("lets screen-share win over a pin (shared content is what everyone needs)", () => {
    expect(selectLayout(5, true, true)).toBe("presenter");
  });

  it("falls back to the count-based layout with no pin", () => {
    expect(selectLayout(5, false, false)).toBe("grid");
    expect(selectLayout(2, false, false)).toBe("spotlight");
  });
});

describe("nextPinned", () => {
  it("pins a fresh identity", () => {
    expect(nextPinned(null, "alice")).toBe("alice");
    expect(nextPinned("bob", "alice")).toBe("alice");
  });

  it("unpins when toggling the already-pinned identity", () => {
    expect(nextPinned("alice", "alice")).toBe(null);
  });
});

describe("gridColumns", () => {
  it("scales the column count with participants", () => {
    expect(gridColumns(1)).toContain("grid-cols-1");
    expect(gridColumns(4)).toContain("grid-cols-2");
    expect(gridColumns(9)).toContain("sm:grid-cols-3");
    expect(gridColumns(12)).toContain("sm:grid-cols-4");
  });
});

describe("tileGrid", () => {
  it("is a single cell for one tile", () => {
    expect(tileGrid(1, 1000, 600)).toEqual({ cols: 1, rows: 1 });
  });

  it("picks a balanced 2x2 for four tiles in a landscape area", () => {
    expect(tileGrid(4, 1600, 900)).toEqual({ cols: 2, rows: 2 });
  });

  it("fits everyone — cols x rows always covers the count", () => {
    for (const n of [3, 5, 7, 10, 16, 20]) {
      const { cols, rows } = tileGrid(n, 1280, 720);
      expect(cols * rows).toBeGreaterThanOrEqual(n);
      expect(cols).toBeGreaterThan(0);
      expect(rows).toBeGreaterThan(0);
    }
  });

  it("prefers more columns in a wide area and more rows in a tall one", () => {
    const wide = tileGrid(6, 1920, 600);
    const tall = tileGrid(6, 600, 1920);
    expect(wide.cols).toBeGreaterThanOrEqual(tall.cols);
    expect(tall.rows).toBeGreaterThanOrEqual(wide.rows);
  });

  it("falls back to a square-ish grid before the area is measured", () => {
    expect(tileGrid(9, 0, 0)).toEqual({ cols: 3, rows: 3 });
    expect(tileGrid(10, 0, 0)).toEqual({ cols: 4, rows: 3 });
  });
});

describe("tileDensity", () => {
  it("scales chrome down as tiles shrink", () => {
    expect(tileDensity(400)).toBe("normal");
    expect(tileDensity(200)).toBe("compact");
    expect(tileDensity(120)).toBe("tiny");
    expect(tileDensity(0)).toBe("normal"); // unmeasured → full chrome
  });
});

describe("roomShareUrl", () => {
  it("builds the /r/{token} share link from the window origin", () => {
    expect(roomShareUrl("abc123")).toBe(`${window.location.origin}/r/abc123`);
  });
});
