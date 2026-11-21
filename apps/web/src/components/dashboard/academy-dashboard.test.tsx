import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatMoney } from "@/lib/money";
import { AcademyDashboard } from "./academy-dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

const api = {
  getInvoiceSummary: vi.fn(),
  getProfitSummary: vi.fn(),
  rates: vi.fn(),
};
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    // The home screen's rates come through apiFetch (lib/dashboard-money); nothing else may call out.
    apiFetch: vi.fn(async (path: string) => {
      if (path === "/api/dashboard/exchange-rates") return api.rates();
      throw new Error(`unexpected call ${path}`);
    }),
    listStudents: vi.fn(async () => ({ rows: [], total: 12 })),
    listTeachers: vi.fn(async () => ({ rows: [], total: 3 })),
    getPendingAttendance: vi.fn(async () => ({ sessions: [] })),
    getOverdueSessions: vi.fn(async () => ({ sessions: [], count: 0, grace_hours: 4 })),
    getCalendar: vi.fn(async () => ({ sessions: [], group_lessons: [] })),
    listMyPayouts: vi.fn(async () => ({ rows: [] })),
    listTrials: vi.fn(async () => ({ rows: [], total: 0 })),
    getEntitlements: vi.fn(async () => ({ plan: "PRO", limits: {}, usage: {} })),
    getInvoiceSummary: () => api.getInvoiceSummary(),
    getProfitSummary: (y: number, m: number) => api.getProfitSummary(y, m),
  };
});
vi.mock("@/lib/groups-api", () => ({ getGroupLessonsSummary: vi.fn(async () => ({ owed: 0 })) }));
vi.mock("@/components/dashboard/subscription-banner", () => ({ SubscriptionBanner: () => null }));
vi.mock("@/components/quality/my-quality-panel", () => ({ MyQualityPanel: () => null }));
vi.mock("@/components/dashboard/my-lessons-today", () => ({ MyLessonsToday: () => null }));

const academy = { name: "Al-Huda", displayName: "Al-Huda", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "QURAN" as const };
const owner = () =>
  makeSession("ACADEMY_OWNER", {
    academy,
    capabilities: ["invoicing", "payroll"],
    permissions: ["student.read", "teacher.read", "invoice.read", "payout.read"],
  });
const t = arMessages.dashboard;
const egp = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar");
const usd = (minor: number) => formatMoney({ amount: minor, currency: "USD" }, "ar", { trimZeroDecimals: true });
// The stat card is the first place a label appears (the chart's strip repeats some); each is a link.
const card = async (label: string) => (await screen.findAllByText(label, {}, { timeout: 8000 }))[0]!.closest("a") as HTMLElement;

beforeEach(() => {
  // Pounds lead on RAW numbers (90,000 vs 4,000), dollars lead on value ($4,000 = 200,000 EGP).
  api.getInvoiceSummary.mockReset().mockResolvedValue({
    counts: { all: 10, OPEN: 2, CLOSED: 2, PAID: 5, PARTIALLY_PAID: 1 },
    money: [
      { currency: "EGP", billed_minor: 9_000_000, collected_minor: 6_000_000, outstanding_minor: 1_000_000, due_minor: 2_500_000 },
      { currency: "USD", billed_minor: 400_000, collected_minor: 300_000, outstanding_minor: 50_000, due_minor: 100_000 },
    ],
  });
  // Families pay in dollars, teachers are paid in pounds.
  api.getProfitSummary.mockReset().mockImplementation(async (year: number, month: number) => ({
    year,
    month,
    rows: [
      { currency: "USD", revenue_minor: 300_000, payouts_minor: 0, profit_minor: 300_000 },
      { currency: "EGP", revenue_minor: 1_000_000, payouts_minor: 8_000_000, profit_minor: -7_000_000 },
    ],
  }));
  api.rates.mockReset().mockResolvedValue({ home: "EGP", available: true, stale: false, as_of: 1, source: "x", rates: [{ currency: "USD", to_home: 50 }] });
});

describe("AcademyDashboard — money across currencies", () => {
  it("adds every currency up in the academy's currency instead of showing the pound slice", async () => {
    render(withAuth(owner(), <AcademyDashboard />));

    // Collected: 60,000 EGP + $3,000 (150,000 EGP) = 210,000 EGP, with the real amounts under it.
    const collected = await card(t.finance.collected);
    await vi.waitFor(() => expect(collected.textContent).toContain(egp(21_000_000)));
    expect(collected.textContent).toContain(usd(300_000));
    // 210,000 of 290,000 billed.
    expect(collected.textContent).toContain(`72% ${t.kpi.collectionRate}`);

    const billed = await card(t.finance.billed);
    expect(billed.textContent).toContain(egp(29_000_000));

    // One "total due" card, not one per currency: 25,000 EGP + $1,000 (50,000 EGP).
    expect(screen.getAllByText(t.kpi.totalDue)).toHaveLength(1);
    expect((await card(t.kpi.totalDue)).textContent).toContain(egp(7_500_000));
  });

  it("works the month's profit out in one currency: dollars in minus pounds out", async () => {
    render(withAuth(owner(), <AcademyDashboard />));
    // $3,000 + 10,000 EGP − 80,000 EGP salaries = 80,000 EGP profit (per currency it read a dollar
    // profit and a pound loss).
    const profit = await card(t.kpi.netProfit);
    await vi.waitFor(() => expect(profit.textContent).toContain(egp(8_000_000)));
    expect(screen.getAllByText(t.kpi.netProfit)).toHaveLength(1);
    expect((await card(t.kpi.teacherSalaries)).textContent).toContain(egp(8_000_000));
  });

  it("never calls for rates when the academy bills in one currency", async () => {
    api.getInvoiceSummary.mockResolvedValue({
      counts: { all: 1, OPEN: 0, CLOSED: 0, PAID: 1, PARTIALLY_PAID: 0 },
      money: [{ currency: "USD", billed_minor: 400_000, collected_minor: 300_000, outstanding_minor: 0, due_minor: 100_000 }],
    });
    api.getProfitSummary.mockImplementation(async (year: number, month: number) => ({
      year,
      month,
      rows: [{ currency: "USD", revenue_minor: 300_000, payouts_minor: 100_000, profit_minor: 200_000 }],
    }));
    render(withAuth(owner(), <AcademyDashboard />));
    // A dollar academy reads dollars even with its setting on pounds.
    const collected = await card(t.finance.collected);
    await vi.waitFor(() => expect(collected.textContent).toContain(formatMoney({ amount: 300_000, currency: "USD" }, "ar")));
    expect(api.rates).not.toHaveBeenCalled();
  });
});
