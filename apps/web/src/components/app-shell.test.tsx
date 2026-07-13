import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { AppShell } from "./app-shell";

const replace = vi.fn();
const push = vi.fn();
/** Mutable so a test can pretend to be on a detail route; reset to "/" before each. */
let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace, push }),
  usePathname: () => pathname,
}));

// The shell persists the rail and the theme, and the theme writes to <html> — all of which outlive
// a render. Without this, whichever test ran first would decide the others' starting state.
beforeEach(() => {
  pathname = "/";
  push.mockClear();
  replace.mockClear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

/**
 * Wait for the shell's chrome. Plan capabilities now arrive with the session (makeSession supplies
 * them), so there is no entitlements fetch to await — but the badge effects still settle async, so
 * findBy keeps the assertions off the first paint.
 */
const ready = () => screen.findByTestId("sidebar");

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
  it("collapses the sidebar off-canvas by default and prevents horizontal scroll", async () => {
    const { container } = renderShell();
    const sidebar = await ready();

    expect(sidebar.className).toContain("-translate-x-full");
    expect(sidebar.className).toContain("md:translate-x-0");
    expect(sidebar).toHaveAttribute("data-open", "false");
    // The frame clips both axes (`overflow-hidden`), which is a stronger guarantee than the
    // `overflow-x-hidden` this once asserted — the shell owns the viewport and scrolls inside
    // <main>, so nothing should ever escape it in either direction.
    expect(container.firstElementChild?.className).toContain("overflow-hidden");
  });

  it("toggles the drawer via the mobile menu button", async () => {
    const user = userEvent.setup();
    renderShell();
    const sidebar = await ready();

    await user.click(
      screen.getByRole("button", { name: arMessages.header.menu }),
    );

    expect(sidebar).toHaveAttribute("data-open", "true");
  });
});

describe("AppShell role-aware navigation (AC-2.12 / TC-2.23)", () => {
  it("shows an Owner the full academy nav", async () => {
    renderShell("ACADEMY_OWNER");
    await ready();
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
    // Owner is not a platform admin → no Clients roster.
    expect(keys).not.toContain("clients");
  });

  it("limits a Teacher to permitted items (no invoices/payroll/teachers/settings)", async () => {
    renderShell("TEACHER");
    await ready();
    const keys = navKeys();

    expect(keys).toEqual(
      expect.arrayContaining(["dashboard", "schedule", "students"]),
    );
    expect(keys).not.toContain("invoices");
    expect(keys).not.toContain("payroll");
    expect(keys).not.toContain("teachers");
    expect(keys).not.toContain("settings");
    expect(keys).not.toContain("clients");
  });

  it("shows a Super Admin the Clients entry", async () => {
    renderShell("SUPER_ADMIN");
    await ready();
    expect(navKeys()).toContain("clients");
  });

  it("renders the platform Super Admin sidebar as ONE flat list (R2, client-first redesign)", async () => {
    renderShell("SUPER_ADMIN");
    await ready();

    // No module dropdowns anymore — a single flat list in PLATFORM_NAV order, Clients right
    // after Overview (the module idea lives on the client rows now, not in the sidebar).
    expect(document.querySelector("[data-module]")).toBeNull();
    const flat = document.querySelector('[data-testid="platform-nav"]');
    expect(flat).not.toBeNull();

    const keys = navKeys();
    expect(keys).toContain("clients");
    expect(keys).toContain("plans");
    expect(keys.indexOf("clients")).toBeLessThan(keys.indexOf("plans"));
    // Tenant-only items never leak onto the platform view.
    expect(keys).not.toContain("students");
    expect(keys).not.toContain("invoices");
  });
});

describe("AppShell header (TC-2.26)", () => {
  it("shows the current user name and role in the header menu", async () => {
    renderShell("ACADEMY_OWNER", {
      user: { id: "u1", fullName: "Owner Noor", email: "o@x.test" },
    });
    await ready();

    // The header chip shows the short form; the full identity is one click into the menu — which
    // is also the only place sign-out, settings and exit-academy live now.
    const chip = screen.getByTestId("header-user");
    expect(chip).toHaveTextContent("Owner");

    await userEvent.click(chip);

    const user = await screen.findByTestId("current-user");
    expect(user).toHaveTextContent("Owner Noor");
    expect(user).toHaveTextContent("o@x.test");
    expect(user).toHaveTextContent(arMessages.roles.ACADEMY_OWNER);
    expect(
      screen.getByRole("menuitem", { name: arMessages.auth.signOut }),
    ).toBeInTheDocument();
  });

  it("shows the entered-academy indicator + Exit for a Super Admin inside an academy", async () => {
    renderShell("SUPER_ADMIN", { academyId: "academy-1" });

    const indicator = await screen.findByTestId("entered-academy");
    expect(indicator).toHaveTextContent(arMessages.header.exit);
  });

  it("hides the entered-academy indicator on the platform view", async () => {
    renderShell("SUPER_ADMIN", { academyId: null });
    await ready();
    expect(screen.queryByTestId("entered-academy")).toBeNull();
  });
});

describe("AppShell sidebar rail", () => {
  it("collapses to an icon rail, keeps the links reachable, and remembers the choice", async () => {
    const user = userEvent.setup();
    renderShell("ACADEMY_OWNER");
    const sidebar = await ready();

    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(sidebar.className).toContain("w-60");

    await user.click(screen.getByTestId("sidebar-collapse"));

    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(sidebar.className).toContain("w-[4.5rem]");
    // Collapsing must not drop links — the rail hides labels, not destinations. The label survives
    // as the accessible name, so screen readers and the tooltip still announce it.
    expect(navKeys()).toContain("students");
    expect(
      screen.getByRole("link", { name: arMessages.nav.students }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("sidebarCollapsed")).toBe("true");
  });
});

describe("AppShell header", () => {
  it("switches the theme and puts the .dark class on <html>", async () => {
    const user = userEvent.setup();
    renderShell("ACADEMY_OWNER");
    await ready();

    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(screen.getByTestId("theme-toggle"));
    await user.click(
      await screen.findByRole("menuitem", { name: arMessages.theme.dark }),
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("breadcrumbs a detail route back to its list", async () => {
    // /students/abc is not a nav href, but it startsWith one — the crumb must resolve to Students
    // and link back to it, which the old single-label header could not do.
    pathname = "/students/abc-123";
    renderShell("ACADEMY_OWNER");
    await ready();

    const crumb = screen.getByTestId("breadcrumb");
    expect(crumb).toHaveTextContent(arMessages.navGroup.people);
    expect(crumb).toHaveTextContent(arMessages.header.details);
    expect(
      within(crumb).getByRole("link", { name: arMessages.nav.students }),
    ).toHaveAttribute("href", "/students");
  });

  /** Open the palette, type `query`, and Enter on the top hit. */
  async function search(
    user: ReturnType<typeof userEvent.setup>,
    query: string,
  ) {
    await user.click(screen.getByTestId("command-trigger"));
    const palette = await screen.findByTestId("command-palette");
    const input = within(palette).getByRole("textbox");
    await user.type(input, query);
    await user.type(input, "{Enter}");
  }

  it("finds a page through the command palette and navigates to it", async () => {
    const user = userEvent.setup();
    renderShell("ACADEMY_OWNER", { capabilities: ["invoicing"] });
    await ready();

    await search(user, arMessages.nav.invoices.slice(0, 3));

    expect(push).toHaveBeenCalledWith("/invoices");
  });

  it("routes a plan-locked hit to the upgrade page instead of the gated feature", async () => {
    const user = userEvent.setup();
    // No `invoicing` capability → Invoices is locked. The palette must not shortcut the plan gate;
    // the server would 402 the page anyway, so send the owner somewhere that can actually help.
    renderShell("ACADEMY_OWNER", { capabilities: [] });
    await ready();

    await search(user, arMessages.nav.invoices.slice(0, 3));

    expect(push).toHaveBeenCalledWith("/plan");
  });
});
