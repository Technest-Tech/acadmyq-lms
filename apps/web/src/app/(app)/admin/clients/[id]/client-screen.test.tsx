import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../../messages/en.json";
import { ClientScreen } from "./screen";

// The client page: identity header + KPIs straight off the one client read, sections behind a
// tab strip named on the URL, and an Overview whose attention list points at the tab that fixes
// each item.

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/admin/clients/c1",
  useSearchParams: () => nav.params,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getClient: vi.fn(),
  getPlatformSettings: vi.fn(),
  getAcademyOwner: vi.fn(),
  getClientDomains: vi.fn(),
  whatsappStatus: vi.fn(),
  suspendAcademy: vi.fn(),
  reactivateAcademy: vi.fn(),
}));

import * as api from "@/lib/api";

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString();

const sub = (
  over: Partial<api.ModuleSubscription>,
): api.ModuleSubscription => ({
  id: "s1",
  module: "MANAGEMENT",
  status: "ACTIVE",
  is_trial: false,
  trial_start: null,
  trial_end: null,
  activated_at: "2026-01-01T00:00:00Z",
  current_period_start: "2026-09-01T00:00:00Z",
  current_period_end: inDays(20),
  billing_interval: "MONTHLY",
  base_price_minor: 99900,
  addons_price_minor: 0,
  total_cost_minor: 99900,
  currency: "EGP",
  overrides: null,
  plan_id: null,
  ...over,
});

const detail = (over: Partial<api.ClientDetail> = {}): api.ClientDetail => ({
  client: {
    id: "c1",
    name: "Bright Steps",
    client_type: "MANAGEMENT",
    status: "ACTIVE",
    suspended_at: null,
    suspended_reason: null,
    plan_id: null,
    default_currency: "EGP",
    timezone: "Africa/Cairo",
    invoice_grouping: "PER_GUARDIAN",
    billing_day: 1,
    brand_display_name: null,
    brand_logo_url: null,
    subdomain: "bright",
    created_at: "2026-03-01T00:00:00Z",
  },
  summary: {
    owner: {
      id: "u1",
      full_name: "Omar Salem",
      email: "o@bright.eg",
      phone: "+20 100 123 4567",
      is_active: true,
    },
    student_count: 120,
    teacher_count: 8,
    usage: {
      last_login_at: new Date().toISOString(),
      lessons_this_month: 64,
    },
  },
  // Its account in the book: monthly at 999, one cycle late.
  account: {
    id: "acct-1",
    plan: "MONTHLY",
    pay_token: "tok",
    recurring: { deal_id: "d1", amount_minor: 99900, list_amount_minor: null, interval: "MONTHLY", currency: "EGP" },
    next_due_on: inDays(-5).slice(0, 10),
    next_due_minor: 99900,
    next_due_currency: "EGP",
    has_overdue: true,
    overdue: { EGP: 99900 },
    outstanding: { EGP: 199800 },
    pending_proofs: 0,
    active_deals: 1,
  },
  catalog: {
    clientType: "MANAGEMENT",
    allowedModules: ["MANAGEMENT", "VIDEO", "WHATSAPP"],
    modules: {
      MANAGEMENT: { capabilities: { invoicing: "Invoicing" }, limits: {} },
    },
  },
  modules: [
    sub({}),
    sub({
      id: "s2",
      module: "VIDEO",
      is_trial: true,
      trial_end: inDays(3),
      base_price_minor: 40000,
      total_cost_minor: 40000,
    }),
  ],
  addOns: [],
  ...over,
});

const wrap = (permissions: string[]) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider
      value={authValue(makeSession("SUPER_ADMIN", { permissions }))}
    >
      <ToastProvider>
        <ClientScreen clientId="c1" />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

const heading = () =>
  screen.findByRole("heading", { level: 1, name: "Bright Steps" });

describe("ClientScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.params = new URLSearchParams();
    vi.mocked(api.getClient).mockResolvedValue(detail());
    vi.mocked(api.getPlatformSettings).mockResolvedValue({
      settings: {},
    } as never);
    vi.mocked(api.getAcademyOwner).mockResolvedValue({ owner: null });
    vi.mocked(api.getClientDomains).mockRejectedValue(new Error("offline"));
    vi.mocked(api.whatsappStatus).mockResolvedValue({ state: "connected" });
  });

  it("opens on the overview: header facts, KPIs, and what needs attention", async () => {
    render(wrap(["academy.read"]));
    expect(await heading()).toBeInTheDocument();

    expect(screen.getByTestId("client-header")).toHaveTextContent(
      "o@bright.eg",
    );
    expect(screen.getByTestId("kpi-revenue")).toHaveTextContent("999");
    expect(screen.getByTestId("kpi-revenue")).toHaveTextContent("Monthly");
    expect(screen.getByTestId("kpi-unpaid")).toHaveTextContent("late");
    expect(screen.getByTestId("kpi-people")).toHaveTextContent("120");
    expect(screen.getByTestId("kpi-people")).toHaveTextContent("64 lessons this month");
    expect(screen.getByTestId("kpi-login")).toHaveTextContent("Using the system");
    // Who to call, one tap away on WhatsApp.
    expect(screen.getByTestId("client-phone")).toHaveAttribute("href", "https://wa.me/201001234567");

    // Is it being used? Last sign-in, this month's lessons, what it owes.
    expect(screen.getByTestId("usage-lessons")).toHaveTextContent("64");
    expect(screen.getByTestId("usage-unpaid")).toHaveTextContent("late");
    expect(screen.getByTestId("issue-payment-late")).toBeInTheDocument();

    // The video trial ends in 3 days → one attention row, pointing at the Modules tab.
    expect(screen.getByTestId("issue-trial-VIDEO")).toHaveTextContent(
      "Video trial ends in 3 days",
    );
    // …but the banner over the page rings the loudest clock: the late payment, with the tab that settles it.
    expect(screen.getByTestId("client-alarm")).toHaveTextContent("Payment 5 days late");
    expect(screen.getByTestId("client-alarm")).toHaveTextContent("Open subscription");
    expect(screen.getByTestId("fact-owner")).toHaveTextContent("Omar Salem");

    expect(screen.getByTestId("tab-overview")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Five sections, whatever the client holds; the video tab is gone.
    expect(
      Array.from(document.querySelectorAll('[data-testid^="tab-"]')).map((el) => el.getAttribute("data-testid")),
    ).toEqual(["tab-overview", "tab-subscription", "tab-features", "tab-connections", "tab-settings"]);
  });

  it("flags a client nobody has signed in to for weeks", async () => {
    vi.mocked(api.getClient).mockResolvedValue(
      detail({
        summary: {
          ...detail().summary,
          usage: { last_login_at: inDays(-20), lessons_this_month: 0 },
        },
        account: { ...detail().account!, next_due_on: null, next_due_minor: null, has_overdue: false, overdue: {}, outstanding: {} },
      }),
    );
    render(wrap(["academy.read"]));
    await heading();

    expect(screen.getByTestId("issue-inactive")).toHaveTextContent("20 days");
    expect(screen.getByTestId("kpi-login")).toHaveTextContent("20 days without a sign-in");
    expect(screen.getByTestId("kpi-unpaid")).toHaveTextContent("Nothing owed");
  });

  it("names the open section on the URL", async () => {
    nav.params = new URLSearchParams("tab=settings");
    render(wrap(["academy.read", "academy.configure", "academy.delete"]));
    await heading();

    expect(screen.getByTestId("tab-settings")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("client-delete-card")).toBeInTheDocument();
    expect(screen.getByTestId("client-settings-form")).toBeInTheDocument();

    // The domains moved to Connections.
    expect(screen.queryByTestId("client-domains-card")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("tab-subscription"));
    expect(nav.replace).toHaveBeenCalledWith("/admin/clients/c1?tab=subscription", {
      scroll: false,
    });
  });

  it("lands an old tab name in its new section, and anything unknown on the overview", async () => {
    nav.params = new URLSearchParams("tab=billing");
    const { unmount } = render(wrap(["academy.read"]));
    await heading();
    expect(screen.getByTestId("tab-subscription")).toHaveAttribute("aria-selected", "true");
    unmount();

    nav.params = new URLSearchParams("tab=whatsapp");
    const second = render(wrap(["academy.read"]));
    await heading();
    expect(screen.getByTestId("tab-connections")).toHaveAttribute("aria-selected", "true");
    second.unmount();

    nav.params = new URLSearchParams("tab=nonsense");
    render(wrap(["academy.read"]));
    await heading();
    expect(screen.getByTestId("tab-overview")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("client-overview")).toBeInTheDocument();
  });

  it("suspends with a reason from the header dialog, then shows the suspended banner", async () => {
    vi.mocked(api.suspendAcademy).mockResolvedValue({ ok: true } as never);
    const user = userEvent.setup();
    render(wrap(["academy.read", "academy.suspend"]));
    await heading();

    // Suspending waits behind the "more" menu, away from the hand.
    await user.click(screen.getByTestId("client-more"));
    await user.click(await screen.findByTestId("client-suspend"));
    await user.type(screen.getByTestId("suspend-reason"), "Unpaid");
    vi.mocked(api.getClient).mockResolvedValue(
      detail({
        client: {
          ...detail().client,
          status: "SUSPENDED",
          suspended_at: "2026-09-26T00:00:00Z",
          suspended_reason: "Unpaid",
        },
      }),
    );
    await user.click(screen.getByTestId("confirm-suspend"));

    await waitFor(() =>
      expect(api.suspendAcademy).toHaveBeenCalledWith("c1", "Unpaid"),
    );
    expect(await screen.findByTestId("client-reactivate")).toBeInTheDocument();
    expect(screen.getByTestId("issue-suspended")).toBeInTheDocument();
  });
});
