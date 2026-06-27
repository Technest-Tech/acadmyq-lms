import { describe, expect, it } from "vitest";
import { roomShareUrl } from "@/lib/api";
import { gridColumns, selectLayout } from "./layout";
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

describe("roomShareUrl", () => {
  it("builds the /r/{token} share link from the window origin", () => {
    expect(roomShareUrl("abc123")).toBe(`${window.location.origin}/r/abc123`);
  });
});
