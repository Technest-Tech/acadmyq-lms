import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatMoney, formatNumber } from "@/lib/money";
import { DashboardHome } from "./dashboard-home";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

const noon = (offsetDays = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays, 12).toISOString();
};
const lesson = (id: string, status: string, at = noon(), extra: Record<string, unknown> = {}) => ({
  id,
  student_id: `s-${id}`,
  teacher_id: "t1",
  schedule_id: "sch1",
  scheduled_at_utc: at,
  duration_minutes: 30,
  status,
  status_reason: null,
  original_session_id: null,
  student_name: `Student ${id}`,
  teacher_name: "Ustadh Ali",
  ...extra,
});

const api = {
  listStudents: vi.fn(),
  listTeachers: vi.fn(),
  getPendingAttendance: vi.fn(),
  getOverdueSessions: vi.fn(),
  getInvoiceSummary: vi.fn(),
  getCalendar: vi.fn(),
  getProfitSummary: vi.fn(),
  listMyPayouts: vi.fn(),
};
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listStudents: (q: unknown) => api.listStudents(q),
    listTeachers: (q: unknown) => api.listTeachers(q),
    getPendingAttendance: () => api.getPendingAttendance(),
    getOverdueSessions: () => api.getOverdueSessions(),
    getInvoiceSummary: () => api.getInvoiceSummary(),
    getCalendar: (q: unknown) => api.getCalendar(q),
    getProfitSummary: (y: number, m: number) => api.getProfitSummary(y, m),
    listMyPayouts: (q: unknown) => api.listMyPayouts(q),
    getMySubscription: vi.fn(async () => ({ subscription: null })),
    getSessionsByDay: vi.fn(async () => ({ sessions: [] })),
  };
});
vi.mock("@/lib/groups-api", () => ({
  listBoardLessons: vi.fn(async () => ({ lessons: [] })),
  getGroupLessonsSummary: vi.fn(async () => ({ owed: 0, today: 0 })),
}));
vi.mock("@/components/dashboard/subscription-banner", () => ({ SubscriptionBanner: () => null }));
vi.mock("@/components/quality/my-quality-panel", () => ({ MyQualityPanel: () => null }));
// The classic dashboard has its own tests; here it only has to be the one a classic academy gets.
vi.mock("@/components/dashboard/academy-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./academy-dashboard")>()),
  AcademyDashboard: () => <div data-testid="classic-dashboard" />,
}));

const quran = { name: "Al-Huda", displayName: "Al-Huda", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "QURAN" as const };
const ownerPermissions = [
  "student.read", "student.create", "teacher.read", "session.read", "session.mark_attendance", "schedule.read",
  "invoice.read", "invoice.mark_paid", "payout.read", "trial.read",
];
const owner = (capabilities: string[] = ["invoicing", "packages", "payroll", "trials", "modern_look"]) =>
  makeSession("ACADEMY_OWNER", { academy: quran, capabilities, permissions: ownerPermissions });

const t = arMessages.dashboard.modern;
const dash = arMessages.dashboard;
const counted = (n: number) => screen.findByText(formatNumber(n, "ar"), {}, { timeout: 8000 });

beforeEach(() => {
  api.listStudents.mockReset().mockImplementation(async (q: { filter?: { trial_any?: string } }) =>
    q?.filter?.trial_any ? { rows: [{ id: "s-trial" }], total: 1 } : { rows: [], total: 84 },
  );
  api.listTeachers.mockReset().mockResolvedValue({ rows: [], total: 9 });
  api.getPendingAttendance.mockReset().mockResolvedValue({
    sessions: [{ id: "p1", scheduled_at_utc: noon(), status: "SCHEDULED", student_name: "Maryam", teacher_name: "Ustadh Ali" }],
  });
  api.getOverdueSessions.mockReset().mockResolvedValue({ sessions: [], count: 0, grace_hours: 4 });
  api.getInvoiceSummary.mockReset().mockResolvedValue({
    counts: { all: 30, OPEN: 3, CLOSED: 5, PAID: 20, PARTIALLY_PAID: 2 },
    money: [{ currency: "EGP", billed_minor: 9_000_000, collected_minor: 6_000_000, outstanding_minor: 1_000_000, due_minor: 2_500_000 }],
  });
  api.getCalendar.mockReset().mockResolvedValue({
    sessions: [
      lesson("a", "ATTENDED"),
      lesson("b", "SCHEDULED"),
      lesson("c", "ABSENT_UNEXCUSED", noon(-1)),
      lesson("trial", "SCHEDULED", noon(), { student_id: "s-trial", schedule_id: null, student_name: "Huda (trial)" }),
    ],
    group_lessons: [],
  });
  api.getProfitSummary.mockReset().mockImplementation(async (year: number, month: number) => ({
    year,
    month,
    rows: [{ currency: "EGP", revenue_minor: month * 100_000, payouts_minor: 0, profit_minor: 0 }],
  }));
  api.listMyPayouts.mockReset().mockResolvedValue({ rows: [] });
});

describe("DashboardHome — the modern look for a Quran academy", () => {
  it("keeps a Quran academy nobody switched over on the classic dashboard", async () => {
    render(withAuth(owner(["invoicing", "packages"]), <DashboardHome />));
    expect(await screen.findByTestId("classic-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("modern-dashboard")).toBeNull();
  });

  it("opens a switched-over academy on the slim dashboard with the numbers that matter", async () => {
    render(withAuth(owner(), <DashboardHome />));
    expect(await screen.findByTestId("modern-dashboard")).toBeInTheDocument();

    expect(await counted(84)).toBeInTheDocument();
    expect(await counted(9)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.today)).toBeInTheDocument();
    // What students owe, written out, with the open bills under it.
    const owed = formatMoney({ amount: 2_500_000, currency: "EGP" }, "ar", { trimZeroDecimals: true });
    const dueCard = (await screen.findByText(t.kpi.due)).closest("[data-testid=kpi-card]") as HTMLElement;
    await vi.waitFor(() => expect(dueCard.textContent).toContain(owed));
    // Today: three lessons on the calendar (the trial too), one of them done, one still to mark.
    expect(screen.getByText(t.kpi.todayDone.replace("{done}", formatNumber(1, "ar")).replace("{total}", formatNumber(3, "ar")))).toBeInTheDocument();
    expect(screen.getByText(t.kpi.unmarked.replace("{count}", formatNumber(1, "ar")))).toBeInTheDocument();

    const pending = screen.getByTestId("pending-list");
    expect(within(pending).getByText("Maryam")).toBeInTheDocument();
    const trials = screen.getByTestId("trials-list");
    expect(await within(trials).findByText("Huda (trial)")).toBeInTheDocument();
    expect(screen.getByTestId("week-ring")).toBeInTheDocument();
    expect(await screen.findByTestId("revenue-latest")).toBeInTheDocument();
  });

  it("leaves out what the classic dashboard carried and the owning screens already show", async () => {
    render(withAuth(owner(), <DashboardHome />));
    await screen.findByTestId("modern-dashboard");
    await counted(84);

    for (const gone of [dash.plan.usage, dash.actions.title, dash.kpi.teacherSalaries, dash.kpi.netProfit, dash.kpi.hoursThisMonth, dash.finance.invoiceBreakdown, dash.kpi.avgInvoice]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("opens on the centre's banner with the mushaf and the mosque, and no red overdue banner", async () => {
    api.getOverdueSessions.mockResolvedValue({
      sessions: [{ id: "o1", student_name: "Yusuf", teacher_name: "Ustadha Sara" }],
      count: 2,
      grace_hours: 4,
    });
    render(withAuth(owner(), <DashboardHome />));
    const hero = await screen.findByTestId("modern-hero");
    expect(within(hero).getByTestId("quran-hero-art")).toBeInTheDocument();
    await counted(84);

    expect(screen.queryByTestId("dashboard-overdue")).toBeNull();
    expect(screen.queryByText(dash.urgent.overdueTitle)).toBeNull();
    expect(api.getOverdueSessions).not.toHaveBeenCalled();
  });

  it("swaps the mushaf and mosque for the courses picture when the client has courses_art", async () => {
    render(withAuth(owner(["invoicing", "packages", "payroll", "trials", "modern_look", "courses_art"]), <DashboardHome />));
    const hero = await screen.findByTestId("modern-hero");
    expect(within(hero).getByTestId("courses-hero-art")).toBeInTheDocument();
    expect(within(hero).queryByTestId("quran-hero-art")).toBeNull();
    await counted(84);
  });

  it("gives a teacher their own day and pay, not the academy's people and money", async () => {
    api.listMyPayouts.mockResolvedValue({ rows: [] });
    render(
      withAuth(
        makeSession("TEACHER", {
          academy: quran,
          capabilities: ["packages", "payroll", "modern_look"],
          permissions: ["session.read", "session.mark_attendance", "schedule.read", "payout.read_own"],
        }),
        <DashboardHome />,
      ),
    );
    await screen.findByTestId("modern-dashboard");
    expect(await screen.findByText(t.kpi.earnings)).toBeInTheDocument();
    expect(screen.queryByText(t.kpi.teachers)).toBeNull();
    expect(screen.queryByText(t.kpi.due)).toBeNull();
    expect(screen.queryByTestId("revenue-trend")).toBeNull();
    expect(api.getInvoiceSummary).not.toHaveBeenCalled();
  });
});
