import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import arMessages from "../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { AppShell } from "./app-shell";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace }),
}));

function renderShell(
  role: Parameters<typeof makeSession>[0] = "ACADEMY_OWNER",
  overrides = {},
) {
  return render(
    withAuth(
      makeSession(role, overrides),
      <AppShell>
        <p>content</p>
      </AppShell>,
    ),
  );
}

/** The data-nav keys currently rendered in the sidebar. */
function navKeys(): string[] {
  return Array.from(document.querySelectorAll("[data-nav]")).map(
    (el) => el.getAttribute("data-nav")!,
  );
}

describe("AppShell responsiveness (TC-0.16)", () => {
  it("collapses the sidebar off-canvas by default and prevents horizontal scroll", () => {
    const { container } = renderShell();
    const sidebar = screen.getByTestId("sidebar");

    expect(sidebar.className).toContain("-translate-x-full");
    expect(sidebar.className).toContain("md:translate-x-0");
    expect(sidebar).toHaveAttribute("data-open", "false");
    expect(container.firstElementChild?.className).toContain(
      "overflow-x-hidden",
    );
  });

  it("toggles the drawer via the mobile menu button", async () => {
    const user = userEvent.setup();
    renderShell();
    const sidebar = screen.getByTestId("sidebar");

    await user.click(
      screen.getByRole("button", { name: arMessages.header.menu }),
    );

    expect(sidebar).toHaveAttribute("data-open", "true");
  });
});

describe("AppShell role-aware navigation (AC-2.12 / TC-2.23)", () => {
  it("shows an Owner the full academy nav", () => {
    renderShell("ACADEMY_OWNER");
    const keys = navKeys();

    expect(keys).toEqual(
      expect.arrayContaining([
        "dashboard",
        "students",
        "teachers",
        "schedule",
        "invoices",
        "payroll",
        "settings",
      ]),
    );
    // Owner is not a platform admin → no Academies.
    expect(keys).not.toContain("academies");
  });

  it("limits a Teacher to permitted items (no invoices/payroll/teachers/settings)", () => {
    renderShell("TEACHER");
    const keys = navKeys();

    expect(keys).toEqual(
      expect.arrayContaining(["dashboard", "schedule", "students"]),
    );
    expect(keys).not.toContain("invoices");
    expect(keys).not.toContain("payroll");
    expect(keys).not.toContain("teachers");
    expect(keys).not.toContain("settings");
    expect(keys).not.toContain("academies");
  });

  it("shows a Super Admin the Academies entry", () => {
    renderShell("SUPER_ADMIN");
    expect(navKeys()).toContain("academies");
  });
});

describe("AppShell header (TC-2.26)", () => {
  it("shows the current user name and role", () => {
    renderShell("ACADEMY_OWNER", {
      user: { id: "u1", fullName: "Owner Noor", email: "o@x.test" },
    });

    const user = screen.getByTestId("current-user");
    expect(user).toHaveTextContent("Owner Noor");
    expect(user).toHaveTextContent(arMessages.roles.ACADEMY_OWNER);
  });

  it("shows the entered-academy indicator + Exit for a Super Admin inside an academy", () => {
    renderShell("SUPER_ADMIN", { academyId: "academy-1" });

    const indicator = screen.getByTestId("entered-academy");
    expect(indicator).toHaveTextContent(arMessages.header.exit);
  });

  it("hides the entered-academy indicator on the platform view", () => {
    renderShell("SUPER_ADMIN", { academyId: null });
    expect(screen.queryByTestId("entered-academy")).toBeNull();
  });
});
