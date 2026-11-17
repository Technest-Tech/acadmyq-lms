import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatNumber } from "@/lib/money";
import { DashboardHome } from "./dashboard-home";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

const inDays = (days: number, hour = 12) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour).toISOString();
};
const lesson = (id: string, status: string, at: string) => ({
  id,
  student_id: `s-${id}`,
  teacher_id: "t1",
  schedule_id: "sch1",
  scheduled_at_utc: at,
  duration_minutes: 45,
  status,
  status_reason: null,
  original_session_id: null,
  student_name: `Student ${id}`,
  teacher_name: "Ustadh Ali",
});
const report = (id: string, values: Record<string, unknown>) => ({
  id,
  scheduled_at_utc: inDays(-1),
  duration_minutes: 45,
  status: "ATTENDED",
  student_id: `s-${id}`,
  student_name: `Reported ${id}`,
  teacher_id: "t1",
  teacher_name: "Ustadh Ali",
  report_values: values,
  written_at: inDays(-1, 14),
  written_by_name: "Ustadh Ali",
  written_by_teacher: true,
  whatsapp_sent_at: null,
});

const api = {
  getCalendar: vi.fn(),
  getOverdueSessions: vi.fn(),
  listLessonReports: vi.fn(),
  listStudents: vi.fn(),
  listMyPayouts: vi.fn(),
  getInvoiceSummary: vi.fn(),
};
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getCalendar: (q: unknown) => api.getCalendar(q),
    getOverdueSessions: () => api.getOverdueSessions(),
    listLessonReports: (q: unknown) => api.listLessonReports(q),
    listStudents: (q: unknown) => api.listStudents(q),
    listMyPayouts: (q: unknown) => api.listMyPayouts(q),
    getInvoiceSummary: () => api.getInvoiceSummary(),
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

const quran = { name: "Al-Huda", displayName: "Al-Huda", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "QURAN" as const };
const teacher = (capabilities: string[] = ["payroll"]) =>
  makeSession("TEACHER", {
    academy: quran,
    capabilities,
    permissions: ["session.read", "session.mark_attendance", "session.write_report", "schedule.read", "student.read", "payout.read_own"],
  });

const t = arMessages.dashboard.teacher;

beforeEach(() => {
  api.getCalendar.mockReset().mockResolvedValue({
    sessions: [
      // Two taught this month (if the month is young the "yesterday" one may sit in the last one —
      // the KPI is asserted only where it cannot move).
      lesson("done", "ATTENDED", inDays(0, 0)),
      lesson("free", "FREE", inDays(0, 0)),
      lesson("cancelled", "CANCELLED_BY_STUDENT", inDays(0, 0)),
      lesson("next", "SCHEDULED", inDays(2)),
      lesson("later", "SCHEDULED", inDays(4)),
    ],
    group_lessons: [],
  });
  api.getOverdueSessions.mockReset().mockResolvedValue({ sessions: [], count: 0, grace_hours: 4, truncated: false });
  api.listLessonReports.mockReset().mockImplementation(async (q: { pageSize?: number }) =>
    q.pageSize === 1
      ? { rows: [], total: 7, page: 1, pageSize: 1, counts: { written: 7, missing: 3 }, fields: [] }
      : {
          rows: [report("r1", { report_text: "<p>حفظ سورة الملك</p>" })],
          total: 1,
          page: 1,
          pageSize: 4,
          counts: { written: 1, missing: 0 },
          fields: [],
        },
  );
  api.listStudents.mockReset().mockResolvedValue({ rows: [], total: 12 });
  api.listMyPayouts.mockReset().mockResolvedValue({ rows: [] });
  api.getInvoiceSummary.mockReset();
});

describe("TeacherDashboard — a teacher's own home", () => {
  it("opens a Quran academy's teacher on their day, classic look or modern", async () => {
    for (const caps of [["payroll"], ["payroll", "modern_look"]]) {
      const { unmount } = render(withAuth(teacher(caps), <DashboardHome />));
      expect(await screen.findByTestId("teacher-dashboard")).toBeInTheDocument();
      expect(screen.queryByTestId("modern-dashboard")).toBeNull();
      unmount();
    }
    expect(api.getInvoiceSummary).not.toHaveBeenCalled();
  });

  it("shows the month's reports with what is still owed, and links straight to them", async () => {
    render(withAuth(teacher(), <DashboardHome />));

    const alert = await screen.findByTestId("teacher-alert-reports");
    expect(alert).toHaveAttribute("href", "/lesson-reports?tab=missing&period=month");
    expect(alert.textContent).toContain(formatNumber(3, "ar"));
    expect(screen.queryByTestId("teacher-alert-overdue")).toBeNull();

    const reportsCard = (await screen.findByText(t.kpi.reports)).closest("[data-testid=kpi-card]") as HTMLElement;
    await vi.waitFor(() => expect(reportsCard.textContent).toContain(formatNumber(7, "ar")));
    const studentsCard = screen
      .getAllByText(t.kpi.students)
      .map((el) => el.closest("[data-testid=kpi-card]"))
      .find(Boolean) as HTMLElement;
    await vi.waitFor(() => expect(studentsCard.textContent).toContain(formatNumber(12, "ar")));

    // This month's counts are asked from the first of the month.
    const monthQuery = api.listLessonReports.mock.calls.map((c) => c[0] as { pageSize: number; filter?: { from?: string } }).find((q) => q.pageSize === 1);
    expect(monthQuery?.filter?.from).toBeTruthy();
  });

  it("opens a recent report in place, whole", async () => {
    render(withAuth(teacher(), <DashboardHome />));
    const recent = await screen.findByTestId("teacher-recent-reports");
    fireEvent.click(await within(recent).findByText("Reported r1"));

    const body = await screen.findByTestId("lesson-report-text");
    expect(body.textContent).toContain("حفظ سورة الملك");
    expect(screen.getByText(t.recent.studentHistory.replace("{name}", "Reported r1")).closest("a")).toHaveAttribute(
      "href",
      "/lesson-reports?student=s-r1",
    );
  });

  it("lists what is coming in the next days, and raises lessons never marked", async () => {
    api.getOverdueSessions.mockResolvedValue({ sessions: [], count: 2, grace_hours: 4, truncated: false });
    render(withAuth(teacher(), <DashboardHome />));

    const upcoming = await screen.findByTestId("teacher-upcoming");
    expect(await within(upcoming).findByText("Student next")).toBeInTheDocument();
    expect(within(upcoming).getByText("Student later")).toBeInTheDocument();
    expect(within(upcoming).queryByText("Student done")).toBeNull();

    expect(await screen.findByTestId("teacher-alert-overdue")).toHaveAttribute("href", "/attendance?view=overdue");
  });
});
