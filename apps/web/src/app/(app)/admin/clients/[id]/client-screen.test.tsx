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
      is_active: true,
    },
    student_count: 120,
    teacher_count: 8,
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
    expect(screen.getByTestId("kpi-revenue")).toHaveTextContent(
      "1 paid modules",
    );
    expect(screen.getByTestId("kpi-modules")).toHaveTextContent("2 of 3");
    expect(screen.getByTestId("kpi-people")).toHaveTextContent("120");

    // The video trial ends in 3 days → one attention row, pointing at the Modules tab.
    expect(screen.getByTestId("issue-trial-VIDEO")).toHaveTextContent(
      "Video trial ends in 3 days",
    );
    expect(screen.getByTestId("fact-owner")).toHaveTextContent("Omar Salem");

    expect(screen.getByTestId("tab-overview")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // No WhatsApp module → no WhatsApp tab.
    expect(screen.queryByTestId("tab-whatsapp")).toBeNull();
    expect(screen.getByTestId("tab-video")).toBeInTheDocument();
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

    const user = userEvent.setup();
    await user.click(screen.getByTestId("tab-modules"));
    expect(nav.replace).toHaveBeenCalledWith("/admin/clients/c1?tab=modules", {
      scroll: false,
    });
  });

  it("falls back to the overview for a tab the client does not have", async () => {
    nav.params = new URLSearchParams("tab=whatsapp");
    render(wrap(["academy.read"]));
    await heading();
    expect(screen.getByTestId("tab-overview")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("client-overview")).toBeInTheDocument();
  });

  it("suspends with a reason from the header dialog, then shows the suspended banner", async () => {
    vi.mocked(api.suspendAcademy).mockResolvedValue({ ok: true } as never);
    const user = userEvent.setup();
    render(wrap(["academy.read", "academy.suspend"]));
    await heading();

    await user.click(screen.getByTestId("client-suspend"));
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
