import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatNumber } from "@/lib/money";
import { DashboardHome } from "./dashboard-home";

/** A stat card counts up over ~0.8s, in the locale's digits. */
const counted = (n: number) => screen.findByText(formatNumber(n, "ar"), {}, { timeout: 8000 });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

const centreNumbers = vi.fn();
vi.mock("@/lib/centre-dashboard-api", () => ({
  getCentreDashboard: () => centreNumbers(),
}));

const overview = vi.fn();
vi.mock("@/lib/accounting-api", () => ({
  getAccountingOverview: () => overview(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getProfitSummary: vi.fn(async () => ({ year: 2026, month: 11, rows: [{ currency: "EGP", revenue_minor: 900_000, payouts_minor: 350_000, profit_minor: 550_000 }] })),
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
    permissions: ["group.read", "session.read", "schedule.read", "invoice.read", "package.read", "trial.read", "student.read", "student.create", "payout.read"],
  });

beforeEach(() => {
  centreNumbers.mockReset().mockResolvedValue({
    today: { date: "2026-11-04", group_lessons: 5, group_unmarked: 2, private_lessons: 3, private_unmarked: 0 },
    week: { from: "2026-10-31", to: "2026-11-06", held: 12, present: 90, absent: 10, attendance_rate: 0.9 },
    groups: { running: 7, members: 61, capacity: 70, free_seats: 9 },
    subscriptions: { open: 40, ending_soon: 4, ending_soon_days: 7 },
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
  it("shows a centre its classes, sheets, attendance, groups, seats, subscriptions and placements", async () => {
    render(withAuth(ownerSession(), <DashboardHome />));
    const t = arMessages.dashboard.centre;

    expect(await screen.findByTestId("centre-dashboard")).toBeInTheDocument();
    // Today's classes = group + private; the unmarked card is the group sheets owed.
    expect(await screen.findByText(t.kpi.todayClasses)).toBeInTheDocument();
    expect(await counted(8)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.unmarked)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.unmarkedSub)).toBeInTheDocument();
    // Attendance reads as a percentage.
    expect(screen.getByText(t.kpi.attendanceRate)).toBeInTheDocument();
    expect(await counted(90)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.runningGroups)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.freeSeats)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.endingSoon)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.trials)).toBeInTheDocument();
    // The money block: collected, owed, salaries — each from its own screen.
    expect(screen.getByText(t.kpi.collected)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.outstanding)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.salaries)).toBeInTheDocument();
    expect(centreNumbers).toHaveBeenCalledTimes(1);
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it("keeps the money block away from a client without receipts or payroll", async () => {
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", {
          academy: centreAcademy,
          capabilities: ["invoicing", "packages", "groups", "centre"],
          permissions: ["group.read", "session.read", "package.read"],
        }),
        <DashboardHome />,
      ),
    );
    const t = arMessages.dashboard.centre;

    expect(await screen.findByText(t.kpi.todayClasses)).toBeInTheDocument();
    expect(screen.queryByText(t.kpi.collected)).toBeNull();
    expect(screen.queryByText(t.kpi.salaries)).toBeNull();
    expect(screen.queryByText(t.kpi.trials)).toBeNull();
    expect(overview).not.toHaveBeenCalled();
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
    expect(screen.queryByText(arMessages.dashboard.centre.kpi.todayClasses)).toBeNull();
    expect(centreNumbers).not.toHaveBeenCalled();
  });
});
