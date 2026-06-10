import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button in RTL (TC-0.15)", () => {
  it("places a leading icon at the logical start (DOM-first) under dir=rtl", () => {
    render(
      <div dir="rtl">
        <Button>
          <svg data-testid="icon" />
          حفظ
        </Button>
      </div>,
    );

    const button = screen.getByRole("button");
    const icon = screen.getByTestId("icon");

    // The icon is the first DOM child → under a flex row with dir=rtl it renders
    // on the right (mirrored). Visual mirroring is asserted end-to-end in CI.
    expect(button.firstElementChild).toBe(icon);
    expect(button.closest("[dir]")).toHaveAttribute("dir", "rtl");
    // Spacing uses logical `gap`, not physical ml-/mr-, so it mirrors cleanly.
    expect(button.className).toMatch(/\bgap-/);
  });
});
