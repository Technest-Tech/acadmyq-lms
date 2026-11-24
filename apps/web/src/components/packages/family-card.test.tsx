import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyColumns } from "./family-card";

/**
 * Due and Open as small family tiles side by side (Ahmed 2026-11-24: full-width cards "take the
 * whole page — I have a lot of students"; a plain grid left holes). The columns come from the room
 * on the page, and each tile goes to the shortest column so far, in page order.
 */
describe("FamilyColumns", () => {
  let width = 1000;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Back to jsdom's own (always 0).
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 0 });
  });

  const tiles = ["A", "B", "C", "D", "E"].map((name) => (
    <div key={name} data-testid="tile">
      {name}
    </div>
  ));

  it("fits as many ~300px columns as the page has room for, at most four", () => {
    width = 1000;
    const { rerender } = render(
      <FamilyColumns testId="cols" weights={[1, 1, 1, 1, 1]}>
        {tiles}
      </FamilyColumns>,
    );
    expect(screen.getByTestId("cols").children).toHaveLength(3);

    width = 2400;
    rerender(
      <FamilyColumns testId="cols" weights={[1, 1, 1, 1, 1]} key="wide">
        {tiles}
      </FamilyColumns>,
    );
    expect(screen.getByTestId("cols").children).toHaveLength(4);
  });

  it("deals each tile to the shortest column so far, so a big family leaves no hole and the order reads across", () => {
    width = 1000; // three columns
    render(
      <FamilyColumns testId="cols" weights={[3, 1, 1, 1, 1]}>
        {tiles}
      </FamilyColumns>,
    );
    const columns = [...screen.getByTestId("cols").children].map((c) => c.textContent);
    // A is tall: B and C start the other columns, then D and E fill under them, not under A.
    expect(columns).toEqual(["A", "BD", "CE"]);
  });
});
