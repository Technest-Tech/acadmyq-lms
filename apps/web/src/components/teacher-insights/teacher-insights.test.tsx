import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { TeacherInsights } from "./teacher-insights";

// Teacher performance: the academy's four numbers, the ranked teacher table, and a teacher's
// lessons behind their row. The fixture mirrors the API test (TeacherInsightsTest.php).

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getTeacherInsights: vi.fn(),
  getTeacherInsightLessons: vi.fn(),
}));

import * as api from "@/lib/api";

const scores = (o: {
  score: number | null;
  join?: Partial<api.InsightJoin>;
  reports?: Partial<api.InsightReports>;
  attendance?: Partial<api.InsightAttendance>;
}): api.InsightScores => ({
  score: o.score,
  join: {
    measured: 0, entered: 0, on_time: 0, late: 0, missed: 0, pending: 0,
    on_time_rate: null, entered_rate: null, avg_delay_minutes: null, avg_late_minutes: null, ...o.join,
  },
  reports: {
    due: 0, filed: 0, on_time: 0, late: 0, missing: 0, pending: 0,
    on_time_rate: null, filed_rate: null, avg_delay_minutes: null, ...o.reports,
  },
  attendance: {
    lessons: 0, attended: 0, free: 0, student_absent: 0, teacher_absent: 0, student_cancelled: 0,
    unmarked: 0, in_progress: 0, teacher_attendance_rate: null, teacher_absence_rate: null,
    student_attendance_rate: null, ...o.attendance,
  },
});

const mona: api.InsightTeacher = {
  id: "mona", name: "Mona", is_active: true, has_meeting_url: true, tracking_since: "2026-09-01T00:00:00+00:00",
  ...scores({
    score: 54.4,
    join: { measured: 4, entered: 3, on_time: 2, late: 1, missed: 1, pending: 1, on_time_rate: 50, entered_rate: 75, avg_delay_minutes: 5, avg_late_minutes: 12 },
    reports: { due: 3, filed: 2, on_time: 1, late: 1, missing: 1, pending: 1, on_time_rate: 33.3, filed_rate: 66.7, avg_delay_minutes: 80 },
    attendance: { lessons: 6, attended: 3, student_absent: 1, teacher_absent: 1, in_progress: 1, teacher_attendance_rate: 80, teacher_absence_rate: 20, student_attendance_rate: 75 },
  }),
};
const karim: api.InsightTeacher = {
  id: "karim", name: "Karim", is_active: true, has_meeting_url: false, tracking_since: null,
  ...scores({
    score: 100,
    reports: { due: 1, filed: 1, on_time: 1, on_time_rate: 100, filed_rate: 100, avg_delay_minutes: 15 },
    attendance: { lessons: 1, attended: 1, teacher_attendance_rate: 100, teacher_absence_rate: 0, student_attendance_rate: 100 },
  }),
};
const salma: api.InsightTeacher = {
  id: "salma", name: "Salma", is_active: true, has_meeting_url: true, tracking_since: "2026-09-01T00:00:00+00:00",
  ...scores({ score: null }),
};

const insights: api.TeacherInsights = {
  window: { from: "2026-09-20", to: "2026-09-26", timezone: "Africa/Cairo" },
  thresholds: { late_minutes: 5, report_minutes: 120, opens_minutes_before: 10 },
  totals: scores({
    score: 61.1,
    join: { measured: 4, entered: 3, on_time: 2, late: 1, missed: 1, pending: 1, on_time_rate: 50, entered_rate: 75, avg_delay_minutes: 5, avg_late_minutes: 12 },
    reports: { due: 4, filed: 3, on_time: 2, late: 1, missing: 1, pending: 1, on_time_rate: 50, filed_rate: 75, avg_delay_minutes: 58.3 },
    attendance: { lessons: 7, attended: 4, student_absent: 1, teacher_absent: 1, in_progress: 1, teacher_attendance_rate: 83.3, teacher_absence_rate: 16.7, student_attendance_rate: 80 },
  }),
  teachers: [karim, mona, salma],
};

const lesson = (o: Partial<api.InsightLesson> & { id: string }): api.InsightLesson => ({
  scheduled_at_utc: "2026-09-24T10:00:00+00:00", local_date: "2026-09-24", duration_minutes: 30, status: "ATTENDED",
  student_name: "Omar", join_bucket: "on_time", first_joined_at: "2026-09-24T10:03:00+00:00", join_delay_minutes: 3,
  presses: 1, report_bucket: "on_time", reported_at: "2026-09-24T10:40:00+00:00", report_delay_minutes: 10, ...o,
});

const monaLessons: api.TeacherInsightLessons = {
  window: insights.window,
  thresholds: insights.thresholds,
  teacher: { id: "mona", name: "Mona", is_active: true, has_meeting_url: true, tracking_since: "2026-09-01T00:00:00+00:00" },
  lessons: [
    lesson({ id: "l1" }),
    lesson({
      id: "l2", scheduled_at_utc: "2026-09-24T12:00:00+00:00", student_name: "Laila", join_bucket: "late",
      first_joined_at: "2026-09-24T12:12:00+00:00", join_delay_minutes: 12, presses: 2,
      report_bucket: "late", reported_at: "2026-09-24T15:00:00+00:00", report_delay_minutes: 150,
    }),
    lesson({ id: "l4", status: "CANCELLED_BY_TEACHER", join_bucket: "not_tracked", first_joined_at: null, join_delay_minutes: null, report_bucket: "not_needed", reported_at: null, report_delay_minutes: null }),
  ],
  truncated: false,
};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>
);

const table = () => screen.getByTestId("insights-table");
const rowNames = () => within(table()).getAllByTestId("insights-row").map((r) => r.getAttribute("data-teacher"));

describe("TeacherInsights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTeacherInsights).mockResolvedValue(insights);
    vi.mocked(api.getTeacherInsightLessons).mockResolvedValue(monaLessons);
  });

  it("shows the academy's numbers with the counts behind them", async () => {
    render(wrap(<TeacherInsights />));

    expect(await screen.findByTestId("kpi-enter")).toHaveTextContent("50%");
    expect(screen.getByTestId("kpi-enter")).toHaveTextContent("2 of 4 lessons · 5 min after the start on average");
    expect(screen.getByTestId("kpi-reports")).toHaveTextContent("50%");
    expect(screen.getByTestId("kpi-reports")).toHaveTextContent("58 min after the lesson on average");
    expect(screen.getByTestId("kpi-attendance")).toHaveTextContent("83%");
    expect(screen.getByTestId("kpi-attendance")).toHaveTextContent("1 teacher absence · students attended 80%");
    expect(screen.getByTestId("kpi-score")).toHaveTextContent("61");
    expect(screen.getByTestId("kpi-score")).toHaveTextContent("Across 2 teachers who taught in this period");

    expect(api.getTeacherInsights).toHaveBeenCalledWith(expect.objectContaining({ late_minutes: 5, report_minutes: 120 }));
  });

  it("ranks teachers by score, flags a missing link, and re-sorts by any column", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherInsights />));
    await screen.findByTestId("insights-table");

    // Karim 100, Mona 54.4, Salma has nothing to score — last.
    expect(rowNames()).toEqual(["karim", "mona", "salma"]);
    const karimRow = within(table()).getAllByTestId("insights-row")[0];
    expect(karimRow).toHaveTextContent("No link");
    expect(karimRow).toHaveTextContent("Not measured");
    expect(screen.getByTestId("insights-no-link")).toHaveTextContent("1 teacher has no meeting link");

    const monaRow = within(table()).getAllByTestId("insights-row")[1];
    expect(monaRow).toHaveTextContent("50%");
    expect(monaRow).toHaveTextContent("2/4");
    expect(monaRow).toHaveTextContent("1 h 20 min");
    expect(monaRow).toHaveTextContent("1 absence");

    await user.click(screen.getByTestId("insights-sort-lessons"));
    expect(rowNames()).toEqual(["mona", "karim", "salma"]);

    await user.type(screen.getByTestId("insights-search"), "sal");
    expect(rowNames()).toEqual(["salma"]);
  });

  it("calls out who needs attention, and only with enough lessons to judge", async () => {
    render(wrap(<TeacherInsights />));

    expect(await screen.findByTestId("highlight-attention")).toHaveTextContent("Mona");
    expect(screen.getByTestId("highlight-punctual")).toHaveTextContent("Mona");
    // Nobody has filed three reports yet.
    expect(screen.getByTestId("highlight-fastest")).toHaveTextContent("Not enough lessons yet");
  });

  it("opens a teacher's lessons and narrows them to what cost the numbers", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherInsights />));
    await screen.findByTestId("insights-table");

    await user.click(within(table()).getAllByTestId("insights-row")[1]!);
    const detail = await screen.findByTestId("insight-detail");
    expect(api.getTeacherInsightLessons).toHaveBeenCalledWith("mona", expect.objectContaining({ late_minutes: 5, report_minutes: 120 }));

    const lessons = await within(detail).findByTestId("insight-lessons");
    expect(within(lessons).getAllByTestId("insight-lesson")).toHaveLength(3);
    const late = within(lessons).getByText("Laila").closest("tr")!;
    expect(late).toHaveTextContent("12 min after start");
    expect(late).toHaveTextContent("×2");
    expect(late).toHaveTextContent("2 h 30 min after the lesson");

    await user.click(within(detail).getByTestId("insight-filter-lateReport"));
    expect(within(lessons).getAllByTestId("insight-lesson")).toHaveLength(1);
    await user.click(within(detail).getByTestId("insight-filter-absent"));
    expect(within(lessons).getAllByTestId("insight-lesson")[0]).toHaveAttribute("data-join", "not_tracked");
  });

  it("reloads when a threshold changes", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherInsights />));
    await screen.findByTestId("insights-table");

    await user.click(screen.getByTestId("insights-late-10"));
    await waitFor(() => expect(api.getTeacherInsights).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.getTeacherInsights).mock.calls.at(-1)![0]).toMatchObject({ late_minutes: 10 });

    await user.click(screen.getByTestId("insights-report-360"));
    await waitFor(() => expect(api.getTeacherInsights).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.getTeacherInsights).mock.calls.at(-1)![0]).toMatchObject({ report_minutes: 360 });
  });
});
