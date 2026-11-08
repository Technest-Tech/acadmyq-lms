import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../../messages/ar.json";
import { formatMoney, formatNumber } from "@/lib/money";
import { makeSession, withAuth } from "@/test/auth";
import { AdminDashboardScreen } from "./screen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin",
}));

const api = {
  getAdminDashboard: vi.fn(),
  getFinanceOverview: vi.fn(),
  getDues: vi.fn(),
};
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getAdminDashboard: () => api.getAdminDashboard(),
    getFinanceOverview: () => api.getFinanceOverview(),
    getDues: () => api.getDues(),
  };
});

const month = (back: number) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const dashboard = {
  stats: {
    academies: { total: 12, active: 8, trial: 3, suspended: 1, recent: 2 },
    people: { students: 640, teachers: 41, guardians: 300 },
    module_distribution: [
      { module: "MANAGEMENT", client_count: 11, trial_count: 3 },
      { module: "WHATSAPP", client_count: 4, trial_count: 0 },
    ],
    type_distribution: [],
  },
  recentActivity: [
    { id: "a1", action: "academy.create", actor_name: "Ahmed", academy_name: "Al-Huda", created_at: new Date().toISOString() },
  ],
};

/** Accounts → Dues: every money figure on the home comes from the book. */
const dues = {
  today: "2026-11-07",
  totals: [{ currency: "EGP", month_minor: 900_000, year_minor: 0, total_minor: 5_000_000, outstanding_minor: 450_000, overdue_minor: 300_000, upcoming_minor: 150_000, mrr_minor: 1_250_000, subscriptions: 9 }],
  late: [],
  week: [],
  month: [],
  proofs: [
    {
      id: "p1",
      client_id: "fc2",
      client_name: "Rayan",
      academy_id: "ac2",
      academy_name: "Rayan",
      method: "INSTAPAY",
      amount_minor: 150_000,
      currency: "EGP",
      note: null,
      status: "PENDING",
      reviewed_at: null,
      created_at: new Date().toISOString(),
    },
  ],
  trials: [{ academy_id: "ac1", name: "Noor", trial_end: new Date().toISOString(), days: 2, owner_phone: null }],
  unagreed: [],
  reminders: { enabled: true, ready: true, owner_digest: true },
};

const finance = {
  today: "2026-11-07",
  totals: [{ currency: "EGP", month_minor: 900_000, year_minor: 0, total_minor: 5_000_000, outstanding_minor: 0, overdue_minor: 0, upcoming_minor: 0, mrr_minor: 0, subscriptions: 0 }],
  counts: { clients: 0, active_deals: 0, active_subscriptions: 0, overdue_deals: 0 },
  by_service: [],
  monthly: [
    { month: month(1), currency: "EGP", amount_minor: 600_000 },
    { month: month(0), currency: "EGP", amount_minor: 900_000 },
  ],
  upcoming: [],
  recent_payments: [],
};

const t = arMessages.adminDashboard;
const m = t.modern;
// Testing Library folds a no-break space into a plain one in the page's text, so the expectation does too.
const egp = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar", { trimZeroDecimals: true }).replace(/\s+/g, " ");

function renderAs(permissions: string[]) {
  return render(
    withAuth(
      makeSession("SUPER_ADMIN", { user: { id: "u1", fullName: "Ahmed Omar", email: "a@x.test" }, permissions }),
      <AdminDashboardScreen />,
    ),
  );
}

beforeEach(() => {
  api.getAdminDashboard.mockReset().mockResolvedValue(dashboard);
  api.getFinanceOverview.mockReset().mockResolvedValue(finance);
  api.getDues.mockReset().mockResolvedValue(dues);
});

describe("AdminDashboardScreen — the platform overview in the modern look", () => {
  it("opens on the banner, four numbers, the clients ring, the income chart and the worklists", async () => {
    renderAs(["academy.read", "academy.create", "academy_billing.manage", "platform.manage"]);

    expect(await screen.findByTestId("admin-hero")).toHaveTextContent("Ahmed");
    expect(screen.getByTestId("hero-new-client")).toHaveTextContent(m.hero.newClient);

    expect(await screen.findAllByTestId("kpi-card")).toHaveLength(4);
    expect(await screen.findByText(egp(1_250_000))).toBeInTheDocument();
    expect(screen.getByText(egp(300_000))).toBeInTheDocument();

    const ring = screen.getByTestId("status-ring");
    expect(within(ring).getByText(formatNumber(12, "ar"))).toBeInTheDocument();

    expect(await screen.findByTestId("income-latest")).toHaveTextContent(egp(900_000));
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();

    expect(within(screen.getByTestId("ending-soon")).getByText("Noor")).toBeInTheDocument();
    expect(within(screen.getByTestId("proof-queue")).getByText("Rayan")).toBeInTheDocument();
    expect(within(screen.getByTestId("module-distribution")).getByText(arMessages.clients.modules.MANAGEMENT)).toBeInTheDocument();
  });

  it("leaves the income chart out for someone who cannot read the Finance book", async () => {
    renderAs(["academy.read"]);

    expect(await screen.findAllByTestId("kpi-card")).toHaveLength(4);
    expect(screen.queryByTestId("income-trend")).toBeNull();
    expect(screen.queryByTestId("hero-new-client")).toBeNull();
    expect(api.getFinanceOverview).not.toHaveBeenCalled();
  });

  it("says so when the Finance book has nothing yet, and keeps the rest of the page", async () => {
    api.getFinanceOverview.mockResolvedValue({ ...finance, monthly: [] });
    renderAs(["academy.read", "platform.manage"]);

    expect(await screen.findByText(m.income.empty)).toBeInTheDocument();
    expect(screen.getByTestId("status-ring")).toBeInTheDocument();
  });

  it("refuses without academy.read", () => {
    renderAs([]);
    expect(screen.getByText(t.noPermission)).toBeInTheDocument();
  });
});
