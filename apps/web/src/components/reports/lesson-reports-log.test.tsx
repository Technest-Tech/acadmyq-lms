import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { LessonReportsLog } from "./lesson-reports-log";

const row = (id: string, at: string, values: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  id,
  scheduled_at_utc: at,
  duration_minutes: 30,
  status: "ATTENDED",
  student_id: `s-${id}`,
  student_name: `Student ${id}`,
  teacher_id: "t1",
  teacher_name: "Ustadh Ali",
  report_values: values,
  written_at: values ? at : null,
  written_by_name: values ? "Ustadh Ali" : null,
  written_by_teacher: true,
  whatsapp_sent_at: null,
  ...extra,
});
const fields = [
  { id: "f1", academy_id: "a", key: "tajweed", label_ar: "التجويد", label_en: "Tajweed", field_type: "NUMBER", options: null, sort_order: 1, is_required: false, is_active: true, section: "التقييم", max_value: 10 },
  { id: "f2", academy_id: "a", key: "homework", label_ar: "الواجب", label_en: "Homework", field_type: "TEXT", options: null, sort_order: 2, is_required: false, is_active: false, section: null, max_value: null },
];

const api = { listLessonReports: vi.fn(), listStudents: vi.fn(), listTeachers: vi.fn() };
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listLessonReports: (q: unknown) => api.listLessonReports(q),
    listStudents: (q: unknown) => api.listStudents(q),
    listTeachers: (q: unknown) => api.listTeachers(q),
  };
});
// The lesson's own popup has its own tests; here it only has to open on the right lesson.
vi.mock("@/components/attendance/attendance-report-modal", () => ({
  AttendanceReportModal: ({ sessionId }: { sessionId: string }) => <div data-testid="attendance-modal">{sessionId}</div>,
}));

const t = arMessages.lessonReports;
type Query = { search?: string; page?: number; filter: Record<string, string> };
const lastQuery = () => api.listLessonReports.mock.calls.at(-1)?.[0] as Query;

const teacher = () =>
  makeSession("TEACHER", { permissions: ["session.read", "session.write_report", "student.read"], capabilities: ["payroll"] });
const owner = () =>
  makeSession("ACADEMY_OWNER", { permissions: ["session.read", "session.write_report", "student.read", "teacher.read"] });

beforeEach(() => {
  api.listLessonReports.mockReset().mockImplementation(async (q: Query) =>
    q.filter.tab === "missing"
      ? { rows: [row("m1", "2026-11-10T15:00:00Z", null)], total: 1, page: 1, pageSize: 20, counts: { written: 2, missing: 1 }, fields }
      : {
          rows: [
            row("new", "2026-11-12T15:00:00Z", { report_text: "<p>حفظ سورة <b>الملك</b></p>" }),
            row("old", "2026-10-20T15:00:00Z", { tajweed: 8, homework: "مراجعة جزء عم" }, { written_by_teacher: false, written_by_name: "Office Sara" }),
          ],
          total: 2,
          page: 1,
          pageSize: 20,
          counts: { written: 2, missing: 1 },
          fields,
        },
  );
  api.listStudents.mockReset().mockResolvedValue({ rows: [{ id: "s-new", full_name: "Student new" }], total: 1 });
  api.listTeachers.mockReset().mockResolvedValue({ rows: [{ id: "t1", full_name: "Ustadh Ali" }], total: 1 });
});

describe("LessonReportsLog — سجل التقارير", () => {
  it("lists the written reports by month with their answers, and counts both tabs", async () => {
    render(withAuth(teacher(), <LessonReportsLog />));

    const rows = await screen.findAllByTestId("report-row");
    expect(rows).toHaveLength(2);
    // The free text previews without its markup; the structured answers show as chips, a retired
    // field still labelled.
    expect(within(rows[0]!).getByText("حفظ سورة الملك")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("8 / 10")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("مراجعة جزء عم")).toBeInTheDocument();
    // Saved by the office for the teacher: said so.
    expect(within(rows[1]!).getByText(t.writtenBy.replace("{name}", "Office Sara"))).toBeInTheDocument();

    expect(screen.getByTestId("reports-tab-missing").textContent).toContain("١");
    expect(lastQuery().filter.tab).toBe("written");
    // A teacher has no teacher to pick.
    expect(screen.queryByTestId("reports-teacher")).toBeNull();
  });

  it("opens a report whole and walks to the older lesson and back", async () => {
    render(withAuth(teacher(), <LessonReportsLog />));
    fireEvent.click((await screen.findAllByTestId("report-row"))[0]!);

    const detail = await screen.findByTestId("report-detail");
    expect(within(detail).getByTestId("lesson-report-text").innerHTML).toContain("<b>الملك</b>");
    expect(within(detail).getByTestId("report-newer")).toBeDisabled();

    fireEvent.click(within(detail).getByTestId("report-older"));
    const older = await screen.findByTestId("report-detail");
    expect(within(older).getByText("التقييم")).toBeInTheDocument();
    expect(within(older).getByText("التجويد")).toBeInTheDocument();
    expect(within(older).getByTestId("report-older")).toBeDisabled();

    // Editing hands over to the lesson's own popup.
    fireEvent.click(within(older).getByTestId("report-edit"));
    expect((await screen.findByTestId("attendance-modal")).textContent).toBe("old");
  });

  it("shows the lessons still owed a report, each one a tap from writing it", async () => {
    render(withAuth(teacher(), <LessonReportsLog />));
    await screen.findAllByTestId("report-row");

    fireEvent.click(screen.getByTestId("reports-tab-missing"));
    await waitFor(() => expect(lastQuery().filter.tab).toBe("missing"));
    const owed = await screen.findByText("Student m1");
    expect(screen.getByText(t.notWritten)).toBeInTheDocument();

    fireEvent.click(owed.closest("button")!);
    expect((await screen.findByTestId("attendance-modal")).textContent).toBe("m1");
  });

  it("searches, narrows by period, and lets the office pick a teacher", async () => {
    render(withAuth(owner(), <LessonReportsLog initialPeriod="month" />));
    await screen.findAllByTestId("report-row");
    expect(lastQuery().filter.from).toBeTruthy();
    expect(await screen.findByTestId("reports-teacher")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("reports-search"), { target: { value: "الملك" } });
    await waitFor(() => expect(lastQuery().search).toBe("الملك"), { timeout: 2000 });

    fireEvent.click(screen.getByTestId("reports-period-all"));
    await waitFor(() => expect(lastQuery().filter.from).toBe(""));
  });
});
