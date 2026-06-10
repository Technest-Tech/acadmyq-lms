import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import arMessages from "../../messages/ar.json";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function renderShell() {
  return render(
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      <AppShell>
        <p>content</p>
      </AppShell>
    </NextIntlClientProvider>,
  );
}

describe("AppShell responsiveness (TC-0.16)", () => {
  it("collapses the sidebar off-canvas by default and prevents horizontal scroll", () => {
    const { container } = renderShell();
    const sidebar = screen.getByTestId("sidebar");

    // Off-canvas when closed on mobile; docked from md up.
    expect(sidebar.className).toContain("-translate-x-full");
    expect(sidebar.className).toContain("md:translate-x-0");
    expect(sidebar).toHaveAttribute("data-open", "false");
    // Root clips overflow so 360px viewports never scroll horizontally.
    expect(container.firstElementChild?.className).toContain("overflow-x-hidden");
  });

  it("toggles the drawer via the mobile menu button", async () => {
    const user = userEvent.setup();
    renderShell();
    const sidebar = screen.getByTestId("sidebar");

    await user.click(screen.getByRole("button", { name: arMessages.header.menu }));

    expect(sidebar).toHaveAttribute("data-open", "true");
  });
});
