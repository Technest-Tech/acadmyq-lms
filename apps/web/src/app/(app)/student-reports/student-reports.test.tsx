import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listStudentReportStudents: vi.fn(),
  listMyStudentReports: vi.fn(),
  submitStudentReport: vi.fn(),
  listStudentReportsForReview: vi.fn(),
  approveStudentReport: vi.fn(),
  rejectStudentReport: vi.fn(),
}));

import { StudentReportReviewsScreen } from "../student-report-reviews/screen";
import { StudentReportsScreen } from "./screen";
import * as api from "@/lib/api";
import { makeSession, withAuth } from "@/test/auth";

/** A report row with sensible defaults — override just the fields a test cares about. */
function makeReport(
  over: Partial<api.StudentReportRow> = {},
): api.StudentReportRow {
  return {
    id: "r1",
    student_id: "s1",
    teacher_id: "t1",
    period_month: "2026-06-01",
    title: "June progress",
    body: "Steady improvement in recitation.",
    status: "PENDING",
    review_note: null,
    reviewed_at: null,
    seen_by_teacher_at: null,
    created_at: "2026-07-01T09:00:00Z",
    student_name: "Sara Ali",
    reviewed_by_name: null,
    ...over,
  };
}

const owner = () =>
  makeSession("ACADEMY_OWNER", { permissions: ["student_report.review"] });
const teacher = () =>
  makeSession("TEACHER", { permissions: ["student_report.submit"] });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Student report review queue (admin)", () => {
  it("counts each status, and the tiles filter the queue", async () => {
    vi.mocked(api.listStudentReportsForReview).mockResolvedValue({
      reports: [
        makeReport({ id: "p1", title: "Pending one", status: "PENDING" }),
        makeReport({
          id: "a1",
          title: "Approved one",
          status: "APPROVED",
          reviewed_at: "2026-07-02T09:00:00Z",
          reviewed_by_name: "Owner",
        }),
      ],
    });

    render(withAuth(owner(), <StudentReportReviewsScreen />));

    // Defaults to the pending queue — the reviewer's actual job.
    await screen.findByText("Pending one");
    expect(screen.queryByText("Approved one")).not.toBeInTheDocument();
    expect(screen.getByTestId("filter-PENDING")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(screen.getByTestId("filter-ALL")).getByText("2")).toBeVisible();

    await userEvent.click(screen.getByTestId("filter-APPROVED"));
    expect(screen.getByText("Approved one")).toBeVisible();
    expect(screen.queryByText("Pending one")).not.toBeInTheDocument();
  });

  it("searches across student, teacher and report text", async () => {
    vi.mocked(api.listStudentReportsForReview).mockResolvedValue({
      reports: [
        makeReport({ id: "p1", title: "Recitation", student_name: "Sara Ali" }),
        makeReport({ id: "p2", title: "Tajweed", student_name: "Omar Nabil" }),
      ],
    });

    render(withAuth(owner(), <StudentReportReviewsScreen />));
    await screen.findByText("Recitation");

    await userEvent.type(screen.getByTestId("search"), "omar");

    expect(screen.getByText("Tajweed")).toBeVisible();
    expect(screen.queryByText("Recitation")).not.toBeInTheDocument();
  });

  it("approves the selected reports in bulk with one shared note", async () => {
    vi.mocked(api.listStudentReportsForReview).mockResolvedValue({
      reports: [
        makeReport({ id: "p1", title: "One" }),
        makeReport({ id: "p2", title: "Two" }),
      ],
    });
    vi.mocked(api.approveStudentReport).mockResolvedValue({
      ok: true,
      status: "APPROVED",
    });

    render(withAuth(owner(), <StudentReportReviewsScreen />));
    await screen.findByText("One");

    await userEvent.click(screen.getByTestId("select-all"));
    await userEvent.type(screen.getByTestId("bulk-note"), "Good work");
    await userEvent.click(screen.getByTestId("bulk-approve"));

    await waitFor(() =>
      expect(api.approveStudentReport).toHaveBeenCalledTimes(2),
    );
    expect(api.approveStudentReport).toHaveBeenCalledWith("p1", "Good work");
    expect(api.approveStudentReport).toHaveBeenCalledWith("p2", "Good work");
  });

  it("rejects a single report with its inline note", async () => {
    vi.mocked(api.listStudentReportsForReview).mockResolvedValue({
      reports: [makeReport({ id: "p1" })],
    });
    vi.mocked(api.rejectStudentReport).mockResolvedValue({
      ok: true,
      status: "REJECTED",
    });

    render(withAuth(owner(), <StudentReportReviewsScreen />));
    await screen.findByTestId("student-report-card");

    await userEvent.click(screen.getByTestId("sr-reject"));

    await waitFor(() =>
      expect(api.rejectStudentReport).toHaveBeenCalledWith("p1", undefined),
    );
  });

  it("hides the queue from a user without student_report.review", () => {
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", { permissions: [] }),
        <StudentReportReviewsScreen />,
      ),
    );
    expect(api.listStudentReportsForReview).not.toHaveBeenCalled();
    expect(screen.queryByTestId("student-reports-list")).not.toBeInTheDocument();
  });
});

describe("Student reports composer (teacher)", () => {
  beforeEach(() => {
    vi.mocked(api.listStudentReportStudents).mockResolvedValue({
      students: [{ id: "s1", full_name: "Sara Ali" }],
    });
  });

  it("blocks a second pending report for the same student and month", async () => {
    vi.mocked(api.listMyStudentReports).mockResolvedValue({
      reports: [makeReport({ period_month: "2026-06-01", status: "PENDING" })],
    });

    render(withAuth(teacher(), <StudentReportsScreen />));
    await screen.findByTestId("student-report-form");

    await userEvent.selectOptions(screen.getByTestId("sr-student"), "s1");
    // The month input holds the current month; move it onto the already-pending one.
    const month = screen.getByTestId("sr-month");
    await userEvent.clear(month);
    await userEvent.type(month, "2026-06");
    await userEvent.type(screen.getByTestId("sr-title"), "Another June report");
    await userEvent.type(screen.getByTestId("sr-body"), "More detail.");

    expect(screen.getByTestId("duplicate-warning")).toBeVisible();
    expect(screen.getByTestId("sr-submit")).toBeDisabled();
    expect(api.submitStudentReport).not.toHaveBeenCalled();
  });

  it("submits a report for the chosen student and month", async () => {
    vi.mocked(api.listMyStudentReports).mockResolvedValue({ reports: [] });
    vi.mocked(api.submitStudentReport).mockResolvedValue({
      reportId: "new",
      status: "PENDING",
    });

    render(withAuth(teacher(), <StudentReportsScreen />));
    await screen.findByTestId("student-report-form");

    await userEvent.selectOptions(screen.getByTestId("sr-student"), "s1");
    const month = screen.getByTestId("sr-month");
    await userEvent.clear(month);
    await userEvent.type(month, "2026-06");
    await userEvent.type(screen.getByTestId("sr-title"), "June progress");
    await userEvent.type(screen.getByTestId("sr-body"), "Great month.");
    await userEvent.click(screen.getByTestId("sr-submit"));

    await waitFor(() =>
      expect(api.submitStudentReport).toHaveBeenCalledWith({
        student_id: "s1",
        period_month: "2026-06-01",
        title: "June progress",
        body: "Great month.",
      }),
    );
  });

  it("loads a sent-back report into the composer to revise and resend", async () => {
    vi.mocked(api.listMyStudentReports).mockResolvedValue({
      reports: [
        makeReport({
          status: "REJECTED",
          title: "Too short",
          body: "ok",
          review_note: "Add attendance detail.",
          reviewed_at: "2026-07-02T09:00:00Z",
          reviewed_by_name: "Owner",
        }),
      ],
    });

    render(withAuth(teacher(), <StudentReportsScreen />));
    await screen.findByTestId("my-report-card");

    expect(screen.getByText(/Add attendance detail/)).toBeVisible();
    await userEvent.click(screen.getByTestId("sr-revise"));

    expect(screen.getByTestId("sr-title")).toHaveValue("Too short");
    expect(screen.getByTestId("sr-body")).toHaveValue("ok");
    expect(screen.getByTestId("sr-student")).toHaveValue("s1");
    expect(screen.getByTestId("sr-month")).toHaveValue("2026-06");
  });

  it("fills the body with the outline template on request", async () => {
    vi.mocked(api.listMyStudentReports).mockResolvedValue({ reports: [] });

    render(withAuth(teacher(), <StudentReportsScreen />));
    await screen.findByTestId("student-report-form");

    await userEvent.click(screen.getByTestId("sr-outline"));

    expect(screen.getByTestId("sr-body")).not.toHaveValue("");
    // Once there is text the shortcut steps aside rather than clobbering the draft.
    expect(screen.queryByTestId("sr-outline")).not.toBeInTheDocument();
  });
});
