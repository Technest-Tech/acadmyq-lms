import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatMoney, formatNumber } from "@/lib/money";
import { DashboardHome } from "./dashboard-home";

/** A stat card counts up over ~0.8s, in the locale's digits. */
const counted = (n: number) => screen.findByText(formatNumber(n, "ar"), {}, { timeout: 8000 });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

const centreNumbers = vi.fn();
const trend = vi.fn();
vi.mock("@/lib/centre-dashboard-api", () => ({
  getCentreDashboard: () => centreNumbers(),
  getCentreTrend: (months: number) => trend(months),
}));

const overview = vi.fn();
vi.mock("@/lib/accounting-api", () => ({
  getAccountingOverview: () => overview(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getTrialSummary: vi.fn(async () => ({ total: 4, scheduled: 1, upcoming: 1, today: 0, awaiting_outcome: 0, needs_decision: 2 })),
    getMySubscription: vi.fn(async () => ({ subscription: null })),
    getSessionsByDay: vi.fn(async () => ({ sessions: [] })),
  };
});
vi.mock("@/lib/groups-api", () => ({
  listBoardLessons: vi.fn(async () => ({ lessons: [] })),
  getGroupLessonsSummary: vi.fn(async () => ({ owed: 0, today: 0 })),
}));
// The plan banner reads its own endpoint; a quiet one keeps the test about the dashboard.
vi.mock("@/components/dashboard/subscription-banner", () => ({ SubscriptionBanner: () => null }));

const centreAcademy = { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" as const };
const ownerSession = () =>
  makeSession("ACADEMY_OWNER", {
    academy: centreAcademy,
    capabilities: ["invoicing", "packages", "groups", "trials", "accounting", "centre", "payroll"],
    permissions: ["group.read", "group.manage", "session.read", "schedule.read", "invoice.read", "invoice.mark_paid", "package.read", "trial.read", "student.read", "student.create", "payout.read"],
  });

const t = arMessages.dashboard.centre;
const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const moneyValues = [100_000, 200_000, 300_000, 400_000, 500_000, 750_000];

beforeEach(() => {
  centreNumbers.mockReset().mockResolvedValue({
    today: { date: "2026-11-04", group_lessons: 5, group_unmarked: 2, private_lessons: 3, private_unmarked: 0 },
    week: { from: "2026-10-31", to: "2026-11-06", held: 12, present: 90, absent: 10, attendance_rate: 0.9 },
    groups: { running: 7, members: 61, capacity: 70, free_seats: 9, ending_soon: 1, waiting: 0, delta_pct: 40 },
    subscriptions: { open: 40, ending_soon: 4, ending_soon_days: 7, delta_pct: -20 },
    students: { total: 100, active: 70, new_recent: 10, trial: 5, inactive: 15, delta_pct: 25 },
    latest_groups: [{ id: "g1", name: "English A1", level: "A1", members: 12, capacity: 15 }],
    activity: [{ type: "receipt", name: "Sara", amount_minor: 150_000, currency: "EGP", at: "2026-11-04T09:00:00Z" }],
  });
  trend.mockReset().mockResolvedValue({
    months,
    collected: [{ currency: "EGP", by_month: months.map((month, i) => ({ month, amount_minor: moneyValues[i] })) }],
    lessons: months.map((month) => ({ month, count: 10 })),
  });
  overview.mockReset().mockResolvedValue({
    month: "2026-11",
    today: "2026-11-04",
    collected: [{ currency: "EGP", amount_minor: 1_250_000, count: 18, today_minor: 0, by_method: {}, by_collector: [], by_day: [] }],
    billed: [],
    owed: [{ currency: "EGP", due_minor: 480_000, overdue_minor: 120_000, payers: 6, current: 0, d1_7: 0, d8_30: 0, d31: 0 }],
    credit: [],
    top_debtors: [],
    recent_receipts: [],
  });
});

describe("DashboardHome — the centre's home screen", () => {
  it("opens on the banner and the four numbers, each with its real comparison", async () => {
    render(withAuth(ownerSession(), <DashboardHome />));

    expect(await screen.findByTestId("centre-hero")).toBeInTheDocument();
    expect(screen.getByTestId("hero-add")).toHaveTextContent(t.hero.addNew);

    expect(await screen.findByText(t.kpi.students)).toBeInTheDocument();
    expect(await counted(100)).toBeInTheDocument();
    expect(screen.getByText("+25%")).toBeInTheDocument();
    // Today's classes = group + private; the sheets owed sit on its chip.
    expect(screen.getByText(t.kpi.todayClasses)).toBeInTheDocument();
    expect(await counted(8)).toBeInTheDocument();
    expect(screen.getByText("2 بدون كشف")).toBeInTheDocument();
    expect(screen.getByText("حضور الأسبوع ٩٠%")).toBeInTheDocument();
    expect(screen.getByText(t.kpi.groups)).toBeInTheDocument();
    expect(screen.getByText("+40%")).toBeInTheDocument();
    expect(screen.getByText(t.kpi.subscriptions)).toBeInTheDocument();
    expect(screen.getByText("-20%")).toBeInTheDocument();
    expect(centreNumbers).toHaveBeenCalledTimes(1);
    expect(overview).toHaveBeenCalledTimes(1);
    expect(trend).toHaveBeenCalledWith(6);
  });

  it("shows no percentage when there was nothing to compare with", async () => {
    const numbers = await centreNumbers();
    centreNumbers.mockResolvedValue({
      ...numbers,
      students: { ...numbers.students, delta_pct: null },
      groups: { ...numbers.groups, delta_pct: null },
      subscriptions: { ...numbers.subscriptions, delta_pct: null },
    });
    render(withAuth(ownerSession(), <DashboardHome />));

    expect(await counted(100)).toBeInTheDocument();
    expect(screen.queryByText("+25%")).toBeNull();
    expect(screen.queryByText("+40%")).toBeNull();
    expect(screen.queryByText("-20%")).toBeNull();
    expect(screen.queryByText(t.kpi.vsLastMonth)).toBeNull();
  });

  it("draws the students as slices of the total, and the months' money with its change", async () => {
    render(withAuth(ownerSession(), <DashboardHome />));

    const ring = within(await screen.findByTestId("distribution-ring"));
    expect(ring.getByText(t.distribution.active)).toBeInTheDocument();
    expect(ring.getByText(`${formatNumber(70, "ar")}%`)).toBeInTheDocument();
    expect(ring.getByText(t.distribution.new)).toBeInTheDocument();
    expect(ring.getByText(formatNumber(100, "ar"))).toBeInTheDocument();

    expect(await screen.findByTestId("trend-chart")).toBeInTheDocument();
    expect(screen.getByTestId("trend-latest").textContent).toBe(formatMoney({ amount: 750_000, currency: "EGP" }, "ar", { trimZeroDecimals: true }));
    // 500,000 to 750,000 minor.
    expect(screen.getByText("+50%")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t.trend.owed.split(":")[0]!))).toBeInTheDocument();
  });

  it("gives the lists their rows and a door to the screen that owns them", async () => {
    render(withAuth(ownerSession(), <DashboardHome />));

    const groups = within(await screen.findByTestId("latest-groups"));
    expect(await groups.findByText("English A1")).toBeInTheDocument();
    expect(groups.getByRole("link", { name: new RegExp(t.groups.manage) })).toHaveAttribute("href", "/groups");

    const followUps = within(screen.getByTestId("follow-ups"));
    expect(followUps.getByText(t.followUp.endingSoon)).toBeInTheDocument();
    expect(await followUps.findByText(t.followUp.arrears)).toBeInTheDocument();
    expect(await followUps.findByText(t.followUp.trials)).toBeInTheDocument();

    const activity = within(screen.getByTestId("activity"));
    expect(activity.getByText(/تم تحصيل/)).toBeInTheDocument();
    expect(activity.getByText(/Sara/)).toBeInTheDocument();
  });

  it("charts the lessons held, and keeps the money away, for a client without receipts", async () => {
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", {
          academy: centreAcademy,
          capabilities: ["invoicing", "packages", "groups", "centre"],
          permissions: ["group.read", "session.read", "package.read", "student.read"],
        }),
        <DashboardHome />,
      ),
    );

    expect(await screen.findByText(t.kpi.todayClasses)).toBeInTheDocument();
    expect(await screen.findByText(t.trend.lessons)).toBeInTheDocument();
    expect(screen.queryByText(t.trend.collected)).toBeNull();
    expect(screen.queryByText(t.followUp.arrears)).toBeNull();
    expect(screen.queryByText(t.followUp.trials)).toBeNull();
    expect(overview).not.toHaveBeenCalled();
  });

  it("drops the ring for someone who cannot read students", async () => {
    const numbers = await centreNumbers();
    centreNumbers.mockResolvedValue({ ...numbers, students: null });
    render(withAuth(ownerSession(), <DashboardHome />));

    expect(await screen.findByText(t.kpi.students)).toBeInTheDocument();
    expect(screen.queryByTestId("distribution-ring")).toBeNull();
    expect(screen.queryByText(t.distribution.title)).toBeNull();
  });

  it("gives a teacher their own day, not the centre's numbers", async () => {
    render(
      withAuth(
        makeSession("TEACHER", {
          academy: centreAcademy,
          capabilities: ["groups", "centre"],
        }),
        <DashboardHome />,
      ),
    );

    expect(await screen.findByTestId("centre-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("centre-hero")).toBeInTheDocument();
    expect(screen.queryByText(t.kpi.todayClasses)).toBeNull();
    expect(centreNumbers).not.toHaveBeenCalled();
    expect(trend).not.toHaveBeenCalled();
  });
});
