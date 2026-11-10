import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const getSubscriptionsSummary = vi.fn();
vi.mock("@/lib/subscriptions-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscriptions-api")>()),
  getSubscriptionsSummary: (...a: unknown[]) => getSubscriptionsSummary(...a),
}));

// The shell persists the rail and the theme, and the theme writes to <html> — all of which outlive
// a render. Without this, whichever test ran first would decide the others' starting state.
beforeEach(() => {
  pathname = "/";
  push.mockClear();
  replace.mockClear();
  getSubscriptionsSummary.mockReset().mockResolvedValue({ open: 0, finished_unrenewed: 0, outside_students: 0, due_count: 0, outstanding: [], ending: 0 });
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
    expect(keys).toContain("audit");
    expect(keys.indexOf("clients")).toBeLessThan(keys.indexOf("audit"));
    // Billing, the finance book and pricing are one Accounts entry now — none of the old three.
    expect(keys).not.toContain("plans");
    expect(keys).not.toContain("billing");
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

  it("does not offer a feature we switched off for this client", async () => {
    const user = userEvent.setup();
    // No `invoicing` capability → we switched Invoices off for this client. There is no tier to
    // upgrade to (05-MODULES-NOT-PACKAGES §6), so the feature simply does not exist for them.
    renderShell("ACADEMY_OWNER", { capabilities: [] });
    await ready();

    expect(navKeys()).not.toContain("invoices");

    await search(user, arMessages.nav.invoices.slice(0, 3));

    expect(push).not.toHaveBeenCalled();
  });

  it("hides the screens whose own switch is off, and keeps the ones that are on", async () => {
    // Supervision, packages, teacher quality (+ discounts & awards) and financial statistics each
    // have their own switch now — invoicing and payroll alone no longer carry them.
    const permissions = [
      "schedule.read",
      "student.read",
      "invoice.read",
      "payout.read",
      "payout.adjust",
      "package.read",
      "teacher_quality.read",
      "supervision.stats",
    ];
    renderShell("ACADEMY_OWNER", {
      permissions,
      capabilities: ["invoicing", "payroll", "supervision"],
    });
    await ready();

    const keys = navKeys();
    expect(keys).toContain("invoices");
    expect(keys).toContain("payroll");
    expect(keys).toContain("supervision");
    expect(keys).not.toContain("packages");
    expect(keys).not.toContain("teacherQuality");
    expect(keys).not.toContain("discountsAwards");
    expect(keys).not.toContain("financialStatistics");
  });
});

describe("AppShell — the Groups dropdown (docs/groups)", () => {
  const groupsSession = {
    permissions: ["group.read", "group.manage", "invoice.read", "session.mark_attendance", "student.read"],
  };

  it("is ONE dropdown in the sidebar that opens to the section's pages", async () => {
    const user = userEvent.setup();
    renderShell("ACADEMY_OWNER", groupsSession);
    await ready();

    const parent = document.querySelector('[data-nav="groups"]') as HTMLElement;
    expect(parent.tagName).toBe("BUTTON");
    expect(parent).toHaveAttribute("aria-expanded", "false");
    expect(navKeys()).not.toContain("groupsLessons");

    await user.click(parent);
    expect(parent).toHaveAttribute("aria-expanded", "true");
    expect(navKeys()).toEqual(expect.arrayContaining(["groupsAll", "groupsLessons", "groupsStudents", "groupsPayments", "groupsReports"]));
    expect(document.querySelector('[data-nav="groupsLessons"]')).toHaveAttribute("href", "/groups/lessons");

    // …and a second click closes it.
    await user.click(parent);
    expect(parent).toHaveAttribute("aria-expanded", "false");
    expect(navKeys()).not.toContain("groupsLessons");
  });

  it("stays closed even on one of its pages, and lights that page once opened", async () => {
    const user = userEvent.setup();
    pathname = "/groups/lessons";
    renderShell("ACADEMY_OWNER", groupsSession);
    await ready();

    const parent = document.querySelector('[data-nav="groups"]') as HTMLElement;
    expect(parent).toHaveAttribute("aria-expanded", "false");
    await user.click(parent);
    expect(parent).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector('[data-nav="groupsLessons"]')).toHaveAttribute("data-active", "true");
    expect(document.querySelector('[data-nav="groupsAll"]')).not.toHaveAttribute("data-active");
  });

  it("counts a group's own page as All groups", async () => {
    const user = userEvent.setup();
    pathname = "/groups/0b9f4e2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
    renderShell("ACADEMY_OWNER", groupsSession);
    await ready();
    await user.click(document.querySelector('[data-nav="groups"]') as HTMLElement);

    expect(document.querySelector('[data-nav="groupsAll"]')).toHaveAttribute("data-active", "true");
  });

  it("leaves Payments out for someone who cannot see invoices", async () => {
    const user = userEvent.setup();
    renderShell("SUPERVISOR", { permissions: ["group.read", "group.manage"] });
    await ready();

    await user.click(document.querySelector('[data-nav="groups"]') as HTMLElement);
    expect(navKeys()).toContain("groupsLessons");
    expect(navKeys()).not.toContain("groupsPayments");
  });

  it("is gone entirely when the client does not have group classes", async () => {
    renderShell("ACADEMY_OWNER", { ...groupsSession, capabilities: ["invoicing"] });
    await ready();

    expect(navKeys().filter((k) => k.startsWith("groups"))).toEqual([]);
  });
});

describe("AppShell — centre mode (`centre`, opt-in)", () => {
  const money = { permissions: ["invoice.read", "package.read"] };

  it("calls the packages subscriptions for a centre, and packages for everyone else", async () => {
    renderShell("ACADEMY_OWNER", { ...money, capabilities: ["invoicing", "packages", "centre"] });
    await ready();
    expect(document.querySelector('[data-nav="packages"]')?.textContent).toContain(arMessages.nav.packagesCentre);
    expect(document.querySelector('[data-nav="packagesDue"]')?.textContent).toContain(arMessages.nav.packagesDueCentre);
    expect(document.querySelector('[data-nav="packagesFinished"]')?.textContent).toContain(arMessages.nav.packagesFinishedCentre);
  });

  it("keeps the packages wording for an academy without centre mode", async () => {
    renderShell("ACADEMY_OWNER", { ...money, capabilities: ["invoicing", "packages"] });
    await ready();
    expect(document.querySelector('[data-nav="packages"]')?.textContent).toContain(arMessages.nav.packages);
    expect(document.querySelector('[data-nav="packages"]')?.textContent).not.toContain(arMessages.nav.packagesCentre);
  });
});

describe("AppShell — the Accounting section (docs/groups/01-ACCOUNTING.md)", () => {
  const money = { permissions: ["group.read", "invoice.read", "invoice.mark_paid", "student.read"] };
  const ACCOUNTING = ["invoicing", "groups", "accounting"];
  const accountingKeys = () => navKeys().filter((k) => k.startsWith("accounting") || k === "receipts");

  it("does not exist for a client without accounting — whose Groups section keeps its Payments page, and who gets no Collect button", async () => {
    const user = userEvent.setup();
    renderShell("ACADEMY_OWNER", money);
    await ready();

    expect(accountingKeys()).toEqual([]);
    expect(screen.queryByTestId("header-collect")).toBeNull();
    await user.click(document.querySelector('[data-nav="groups"]') as HTMLElement);
    expect(navKeys()).toContain("groupsPayments");
  });

  it("is ONE dropdown of four pages — overview, arrears, treasury, reports — and replaces the Groups section's Payments", async () => {
    const user = userEvent.setup();
    renderShell("ACADEMY_OWNER", { ...money, capabilities: ACCOUNTING });
    await ready();

    const parent = document.querySelector('[data-nav="accounting"]') as HTMLElement;
    expect(parent.tagName).toBe("BUTTON");
    expect(accountingKeys()).toEqual(["accounting"]);
    await user.click(parent);
    expect(accountingKeys()).toEqual(["accounting", "accountingOverview", "accountingArrears", "accountingTreasury", "accountingReports"]);
    // The pages that became tabs are no longer sidebar items of their own.
    expect(navKeys()).not.toContain("receipts");
    expect(navKeys()).not.toContain("accountingStatement");
    expect(document.querySelector('[data-nav="accountingTreasury"]')).toHaveAttribute("href", "/accounting/treasury");
    expect(document.querySelector('[data-nav="accountingReports"]')).toHaveAttribute("href", "/accounting/reports");

    await user.click(document.querySelector('[data-nav="groups"]') as HTMLElement);
    expect(navKeys()).toContain("groupsReports");
    expect(navKeys()).not.toContain("groupsPayments");
  });

  it("lights only the open sub-page, never the overview with it", async () => {
    const user = userEvent.setup();
    pathname = "/accounting/reports";
    renderShell("ACADEMY_OWNER", { ...money, capabilities: ACCOUNTING });
    await ready();
    await user.click(document.querySelector('[data-nav="accounting"]') as HTMLElement);

    expect(document.querySelector('[data-nav="accountingReports"]')).toHaveAttribute("data-active", "true");
    expect(document.querySelector('[data-nav="accountingOverview"]')).not.toHaveAttribute("data-active");
  });

  it("puts a Collect button in the header for whoever may record a payment, and only them", async () => {
    renderShell("ACADEMY_OWNER", { ...money, capabilities: ACCOUNTING });
    await ready();
    expect(screen.getByTestId("header-collect")).toBeTruthy();
  });

  it("gives no Collect button to someone who may only read the money", async () => {
    renderShell("ACADEMY_OWNER", { permissions: ["invoice.read"], capabilities: ACCOUNTING });
    await ready();
    expect(screen.queryByTestId("header-collect")).toBeNull();
    expect(navKeys()).toContain("accounting");
  });

  it("is hidden from someone who cannot see invoices", async () => {
    renderShell("SUPERVISOR", { permissions: ["group.read"], capabilities: ACCOUNTING });
    await ready();

    expect(accountingKeys()).toEqual([]);
    expect(screen.queryByTestId("header-collect")).toBeNull();
  });
});

describe("AppShell — badge polling", () => {
  it("never asks for a module the academy does not have, and a hidden tab asks nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      renderShell("ACADEMY_OWNER", {
        capabilities: ["invoicing", "packages", "groups", "trials"],
        permissions: ["student.read", "package.read", "course_order.read", "notification.read"],
      });
      await ready();
      await vi.advanceTimersByTimeAsync(50);
      // No LMS: the sales badge is never polled (it used to answer 402 every minute).
      expect(calls.some((u) => u.includes("/api/courses/orders/summary"))).toBe(false);
      expect(calls.some((u) => u.includes("/api/packages/summary"))).toBe(true);

      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      calls.length = 0;
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(calls.filter((u) => u.includes("/summary") || u.includes("/count"))).toEqual([]);

      // Back on screen: it catches up at once.
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10);
      expect(calls.some((u) => u.includes("/api/packages/summary"))).toBe(true);
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("AppShell — the learning centre's shape (`academy.profile === CENTRE`)", () => {
  const centreAcademy = { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" as const };
  const centreSession = {
    academy: centreAcademy,
    capabilities: ["invoicing", "packages", "groups", "trials", "accounting", "centre", "payroll", "certificates"],
    permissions: [
      "group.read", "schedule.read", "session.read", "invoice.read", "package.read", "trial.read",
      "student.read", "guardian.read", "teacher.read", "payout.read", "certificate.read", "notification.read",
    ],
  };

  it("keeps Discounts & Awards for a centre without the rubric's switch; any other academy without it does not", async () => {
    const adjust = [...centreSession.permissions, "payout.adjust"];
    const { unmount } = renderShell("ACADEMY_OWNER", { ...centreSession, permissions: adjust });
    await ready();
    expect(navKeys()).toContain("discountsAwards");
    expect(navKeys()).not.toContain("teacherQuality");
    unmount();

    renderShell("ACADEMY_OWNER", { academy: { ...centreAcademy, profile: "QURAN" as const }, permissions: adjust, capabilities: ["invoicing", "payroll", "groups"] });
    await ready();
    expect(navKeys()).not.toContain("discountsAwards");
  });

  it("opens on Teaching — groups, timetable, attendance, subscriptions — before the people", async () => {
    renderShell("ACADEMY_OWNER", centreSession);
    await ready();
    const keys = navKeys();

    expect(keys.indexOf("groups")).toBeLessThan(keys.indexOf("students"));
    expect(keys.indexOf("schedule")).toBeLessThan(keys.indexOf("students"));
    expect(keys.indexOf("attendance")).toBeLessThan(keys.indexOf("students"));
    expect(keys.indexOf("centreSubscriptions")).toBeLessThan(keys.indexOf("students"));
    expect(keys.indexOf("centreAdmissions")).toBeLessThan(keys.indexOf("students"));
    // The group header exists only for a centre.
    expect(screen.getByText(arMessages.navGroup.teaching)).toBeInTheDocument();
  });

  it("drops the month-bill page (Accounting replaces it) and reads the centre's words", async () => {
    renderShell("ACADEMY_OWNER", centreSession);
    await ready();
    const keys = navKeys();

    expect(keys).not.toContain("invoices");
    expect(keys).toContain("accounting");
    expect(document.querySelector('[data-nav="schedule"]')?.textContent).toContain(arMessages.nav.scheduleCentre);
    // The groups' lessons board IS the Attendance page for a centre, and "group students" is every
    // student it has: neither gets a row of its own. The groups' statistics page keeps its row
    // under a name that no longer collides with a group's own term reports.
    fireEvent.click(document.querySelector('[data-nav="groups"]')!);
    const opened = navKeys();
    expect(opened).not.toContain("groupsLessons");
    expect(opened).not.toContain("groupsStudents");
    expect(opened).toContain("groupsReports");
    expect(document.querySelector('[data-nav="groupsReports"]')?.textContent).toContain(arMessages.nav.groupsReportsCentre);

    // Subscriptions and admissions are a dropdown each, closed until opened.
    expect(keys).not.toContain("subsDue");
    expect(keys).not.toContain("trials");
    fireEvent.click(document.querySelector('[data-nav="centreAdmissions"]')!);
    fireEvent.click(document.querySelector('[data-nav="centreSubscriptions"]')!);
    expect(document.querySelector('[data-nav="trials"]')?.textContent).toContain(arMessages.nav.trialsCentre);
    expect(document.querySelector('[data-nav="subsDue"]')?.textContent).toContain(arMessages.nav.subsDue);
  });

  it("lists the four /subscriptions views under the subscriptions dropdown, hides the packages pages, and carries the due and outside badges (docs/centre-profile/01)", async () => {
    getSubscriptionsSummary.mockResolvedValue({ open: 4, finished_unrenewed: 1, outside_students: 2, due_count: 3, outstanding: [], ending: 0 });
    renderShell("ACADEMY_OWNER", centreSession);
    await ready();
    fireEvent.click(document.querySelector('[data-nav="centreSubscriptions"]')!);
    const keys = navKeys();
    expect(keys.filter((k) => k.startsWith("subs"))).toEqual(["subsDue", "subsOpen", "subsFinished", "subsOutside"]);
    expect(keys).not.toContain("packages");
    expect(keys).not.toContain("packagesDue");
    expect(keys).not.toContain("packagesFinished");
    const href = (key: string) => document.querySelector(`[data-nav="${key}"]`)?.closest("a")?.getAttribute("href") ?? document.querySelector(`[data-nav="${key}"]`)?.getAttribute("href");
    expect(href("subsDue")).toBe("/subscriptions?view=due");
    expect(href("subsOpen")).toBe("/subscriptions?view=open");
    expect(href("subsFinished")).toBe("/subscriptions?view=finished");
    expect(href("subsOutside")).toBe("/subscriptions?view=outside");
    await waitFor(() => expect(getSubscriptionsSummary).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('[data-nav="subsDue"]')?.textContent).toContain("3"));
    expect(document.querySelector('[data-nav="subsOutside"]')?.textContent).toContain("2");
  });

  it("never lists the subscriptions views for a Quran academy, nor asks the API for their numbers", async () => {
    renderShell("ACADEMY_OWNER", { ...centreSession, academy: { ...centreAcademy, profile: "QURAN" as const } });
    await ready();
    const keys = navKeys();
    expect(keys.some((k) => k.startsWith("subs"))).toBe(false);
    expect(keys).toContain("packagesDue");
    expect(getSubscriptionsSummary).not.toHaveBeenCalled();
  });

  it("puts the groups' timetable board behind الجدول الأسبوعي and gives the calendar its own row, in Teaching", async () => {
    renderShell("ACADEMY_OWNER", centreSession);
    await ready();
    const keys = navKeys();

    // Teaching: groups, timetable, calendar, attendance — in that order.
    expect(keys.indexOf("groups")).toBeLessThan(keys.indexOf("schedule"));
    expect(keys.indexOf("schedule")).toBeLessThan(keys.indexOf("calendarCentre"));
    expect(keys.indexOf("calendarCentre")).toBeLessThan(keys.indexOf("attendance"));
    const schedule = document.querySelector('[data-nav="schedule"]')!;
    expect(schedule.getAttribute("href")).toBe("/groups/lessons");
    expect(schedule.textContent).toContain(arMessages.nav.scheduleCentre);
    const calendar = document.querySelector('[data-nav="calendarCentre"]')!;
    expect(calendar.getAttribute("href")).toBe("/calendar");
    expect(calendar.textContent).toContain(arMessages.nav.calendarCentre);
  });

  it("drops the financial statistics for a centre on receipts, and keeps them for everyone else", async () => {
    const withStats = { ...centreSession, capabilities: [...centreSession.capabilities, "financial_statistics"] };
    const { unmount } = renderShell("ACADEMY_OWNER", withStats);
    await ready();
    expect(navKeys()).not.toContain("financialStats");
    unmount();

    // Same academy without receipts: the statistics are its only money report.
    const noReceipts = { ...withStats, capabilities: withStats.capabilities.filter((c) => c !== "accounting") };
    const second = renderShell("ACADEMY_OWNER", noReceipts);
    await ready();
    expect(navKeys()).toContain("financialStats");
    second.unmount();

    // A Quran academy on receipts (Al-Furqan) keeps both pages.
    renderShell("ACADEMY_OWNER", { ...withStats, capabilities: withStats.capabilities.filter((c) => c !== "centre"), academy: { ...centreAcademy, profile: "QURAN" as const } });
    await ready();
    expect(navKeys()).toContain("financialStats");
  });

  it("drops a centre's dropdown when nothing inside it is reachable", async () => {
    renderShell("ACADEMY_OWNER", { ...centreSession, capabilities: ["groups", "centre"], permissions: ["group.read", "student.read"] });
    await ready();
    const keys = navKeys();

    expect(keys).not.toContain("centreSubscriptions");
    expect(keys).not.toContain("centreAdmissions");
  });

  it("leaves a Quran academy's sidebar exactly as it was", async () => {
    renderShell("ACADEMY_OWNER", {
      ...centreSession,
      academy: { ...centreAcademy, profile: "QURAN" as const },
    });
    await ready();
    const keys = navKeys();

    expect(keys).toContain("invoices");
    expect(screen.queryByText(arMessages.navGroup.teaching)).toBeNull();
    expect(keys.indexOf("students")).toBeLessThan(keys.indexOf("groups"));
    // The calendar row is the centre's; a Quran academy's الجدول is the calendar itself.
    expect(keys).not.toContain("calendarCentre");
    expect(document.querySelector('[data-nav="schedule"]')?.getAttribute("href")).toBe("/calendar");
    expect(document.querySelector('[data-nav="trials"]')?.textContent).toContain(arMessages.nav.trials);
    expect(document.querySelector('[data-nav="trials"]')?.textContent).not.toContain(arMessages.nav.trialsCentre);
  });

  it("reads as a Quran academy when the session carries no profile at all", async () => {
    renderShell("ACADEMY_OWNER", { ...centreSession, academy: { ...centreAcademy, profile: undefined } });
    await ready();
    expect(navKeys()).toContain("invoices");
    expect(screen.queryByText(arMessages.navGroup.teaching)).toBeNull();
  });
});

describe("AppShell — the centre's enrolment inbox (docs/centre-profile Phase 2 §6)", () => {
  const academy = { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" as const };
  const permissions = ["trial.read", "group.read", "student.read", "guardian.read", "teacher.read", "notification.read"];

  it("lists طلبات التسجيل right after the placement lessons for a centre, and not at all for a Quran academy", async () => {
    const { unmount } = renderShell("ACADEMY_OWNER", { academy, permissions, capabilities: ["groups", "trials", "centre"] });
    await ready();
    fireEvent.click(document.querySelector('[data-nav="centreAdmissions"]')!);
    const keys = navKeys();
    expect(keys.indexOf("enrolment")).toBe(keys.indexOf("trials") + 1);
    expect(document.querySelector('[data-nav="enrolment"]')?.textContent).toContain(arMessages.nav.enrolment);
    unmount();

    renderShell("ACADEMY_OWNER", { academy: { ...academy, profile: "QURAN" as const }, permissions, capabilities: ["trials"] });
    await ready();
    expect(navKeys()).toContain("trials");
    expect(navKeys()).not.toContain("enrolment");
  });
});

describe("AppShell — the learning centre's look", () => {
  const permissions = ["group.read", "session.read", "student.read", "invoice.read", "notification.read"];
  const capabilities = ["groups", "accounting", "centre", "invoicing"];
  const academy = { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP" };

  it("puts a centre on its own palette and takes the inline brand colours off", async () => {
    document.documentElement.style.setProperty("--primary", "#2f9e6f");
    renderShell("ACADEMY_OWNER", { permissions, capabilities, academy: { ...academy, profile: "CENTRE" as const } });
    await ready();

    expect(document.documentElement.dataset.profile).toBe("centre");
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });

  it("remembers a centre, so the next reload's loading screen is already in its colours", async () => {
    localStorage.removeItem("acq.workspace");
    renderShell("ACADEMY_OWNER", { permissions, capabilities, academy: { ...academy, profile: "CENTRE" as const } });
    await ready();
    expect(localStorage.getItem("acq.workspace")).toBe("centre");
  });

  it("forgets it once a Quran academy opens in the same browser", async () => {
    localStorage.setItem("acq.workspace", "centre");
    renderShell("ACADEMY_OWNER", { permissions, capabilities, academy: { ...academy, profile: "QURAN" as const } });
    await ready();
    expect(localStorage.getItem("acq.workspace")).toBeNull();
  });

  it("leaves a Quran academy on the default colours, with no phone bar", async () => {
    delete document.documentElement.dataset.profile;
    renderShell("ACADEMY_OWNER", { permissions, capabilities, academy: { ...academy, profile: "QURAN" as const } });
    await ready();

    expect(document.documentElement.dataset.profile).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#2f9e6f");
    expect(screen.queryByTestId("bottom-nav")).toBeNull();
  });

  it("gives a centre a phone bar of four screens it can reach", async () => {
    renderShell("ACADEMY_OWNER", { permissions, capabilities, academy: { ...academy, profile: "CENTRE" as const } });
    await ready();

    const keys = Array.from(screen.getByTestId("bottom-nav").querySelectorAll("[data-bottom-nav]")).map((el) =>
      el.getAttribute("data-bottom-nav"),
    );
    expect(keys).toEqual(["dashboard", "groups", "attendance", "students"]);
  });
});

describe("AppShell — the modern look for a Quran academy (`modern_look`)", () => {
  const permissions = ["session.read", "schedule.read", "student.read", "invoice.read", "notification.read"];
  const academy = { name: "Al-Huda", displayName: "Al-Huda", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "QURAN" as const };

  it("wears the modern design in its own palette once the switch is on, and keeps its own sidebar", async () => {
    document.documentElement.style.setProperty("--primary", "#2f9e6f");
    localStorage.removeItem("acq.workspace");
    renderShell("ACADEMY_OWNER", { permissions, capabilities: ["invoicing", "packages", "modern_look"], academy });
    await ready();

    expect(document.documentElement.dataset.look).toBe("modern");
    // Not a centre: no violet palette, and the inline colours give way to the stylesheet's green.
    expect(document.documentElement.dataset.profile).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
    expect(localStorage.getItem("acq.workspace")).toBe("modern");
    // The Quran academy's own sidebar: invoices still there, no centre-only groups.
    expect(navKeys()).toContain("invoices");
    expect(screen.queryByText(arMessages.navGroup.teaching)).toBeNull();
    // A phone bar of its own day.
    const keys = Array.from(screen.getByTestId("bottom-nav").querySelectorAll("[data-bottom-nav]")).map((el) =>
      el.getAttribute("data-bottom-nav"),
    );
    expect(keys).toEqual(["dashboard", "attendance", "students", "schedule"]);
  });

  it("wears the courses & curricula theme with `courses_art` alone: modern design, its own palette", async () => {
    localStorage.removeItem("acq.workspace");
    renderShell("ACADEMY_OWNER", { permissions, capabilities: ["invoicing", "packages", "courses_art"], academy });
    await ready();

    expect(document.documentElement.dataset.look).toBe("modern");
    expect(document.documentElement.dataset.palette).toBe("courses");
    expect(document.documentElement.dataset.profile).toBeUndefined();
    expect(localStorage.getItem("acq.workspace")).toBe("courses");
    expect(navKeys()).toContain("invoices");
  });

  it("leaves every other Quran academy exactly as it was", async () => {
    document.documentElement.dataset.look = "modern";
    document.documentElement.dataset.palette = "courses";
    localStorage.setItem("acq.workspace", "modern");
    renderShell("ACADEMY_OWNER", { permissions, capabilities: ["invoicing", "packages"], academy });
    await ready();

    expect(document.documentElement.dataset.look).toBeUndefined();
    expect(document.documentElement.dataset.profile).toBeUndefined();
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#2f9e6f");
    expect(localStorage.getItem("acq.workspace")).toBeNull();
    expect(screen.queryByTestId("bottom-nav")).toBeNull();
  });

  it("gives it the centre's groups menu once it teaches groups, and keeps its calendar without them", async () => {
    const groupPerms = [...permissions, "group.read", "invoice.read"];
    const { unmount } = renderShell("ACADEMY_OWNER", { permissions: groupPerms, capabilities: ["invoicing", "packages", "groups", "modern_look"], academy });
    await ready();
    fireEvent.click(document.querySelector('[data-nav="groups"]')!);
    const keys = navKeys();
    expect(keys).toEqual(expect.arrayContaining(["groupsAll", "groupsPayments", "groupsReports", "calendarCentre"]));
    expect(keys).not.toContain("groupsLessons");
    expect(keys).not.toContain("groupsStudents");
    // الجدول الأسبوعي is the groups' board; the calendar keeps a row of its own.
    const schedule = document.querySelector('[data-nav="schedule"]')!;
    expect(schedule).toHaveAttribute("href", "/groups/lessons");
    expect(schedule.textContent).toContain(arMessages.nav.scheduleCentre);
    expect(document.querySelector('[data-nav="calendarCentre"]')).toHaveAttribute("href", "/calendar");
    expect(document.querySelector('[data-nav="groupsReports"]')?.textContent).toContain(arMessages.nav.groupsReportsCentre);
    // Still a Quran academy everywhere else: its invoices and packages stay.
    expect(keys).toContain("invoices");
    unmount();

    renderShell("ACADEMY_OWNER", { permissions: groupPerms, capabilities: ["invoicing", "packages", "modern_look"], academy });
    await ready();
    expect(document.querySelector('[data-nav="schedule"]')).toHaveAttribute("href", "/calendar");
    expect(navKeys()).not.toContain("calendarCentre");
  });

  it("leaves a classic Quran academy's groups menu as it was", async () => {
    renderShell("ACADEMY_OWNER", { permissions: [...permissions, "group.read"], capabilities: ["invoicing", "packages", "groups"], academy });
    await ready();
    fireEvent.click(document.querySelector('[data-nav="groups"]')!);
    expect(navKeys()).toEqual(expect.arrayContaining(["groupsLessons", "groupsStudents"]));
    expect(document.querySelector('[data-nav="schedule"]')).toHaveAttribute("href", "/calendar");
    expect(navKeys()).not.toContain("calendarCentre");
  });

  it("puts a centre on the same design with its own palette on top", async () => {
    renderShell("ACADEMY_OWNER", { permissions, capabilities: ["centre"], academy: { ...academy, profile: "CENTRE" as const } });
    await ready();

    expect(document.documentElement.dataset.look).toBe("modern");
    expect(document.documentElement.dataset.profile).toBe("centre");
  });
});

describe("AppShell — the platform Super Admin's own panel in the modern look", () => {
  it("wears the navy and gold design with the platform's phone bar", async () => {
    renderShell("SUPER_ADMIN", {
      permissions: ["academy.read", "academy_billing.manage", "platform.manage", "user.read_platform"],
    });
    await ready();

    expect(document.documentElement.dataset.look).toBe("modern");
    expect(document.documentElement.dataset.profile).toBeUndefined();
    expect(screen.getByTestId("platform-nav")).toBeInTheDocument();
    const keys = Array.from(screen.getByTestId("bottom-nav").querySelectorAll("[data-bottom-nav]")).map((el) =>
      el.getAttribute("data-bottom-nav"),
    );
    expect(keys).toEqual(["adminHome", "clients", "adminFinance"]);
  });

  it("shows an entered academy as that academy looks, not in the platform's design", async () => {
    document.documentElement.dataset.look = "modern";
    renderShell("SUPER_ADMIN", { academyId: "academy-1", capabilities: ["invoicing"] });
    await ready();

    expect(document.documentElement.dataset.look).toBeUndefined();
    expect(screen.queryByTestId("bottom-nav")).toBeNull();
  });
});
