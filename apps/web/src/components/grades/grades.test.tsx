import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import type { GradeSheet as Sheet, TermReportResponse } from "@/lib/grades-api";
import { GradeSheet } from "./grade-sheet";
import { certificateHref, TermReportView } from "./term-report-view";

/**
 * Exams, grades and the term report (docs/centre-profile, Phase 2 §5): the sheet that saves a column
 * as one PUT, and the report that the office publishes and prints — with the handoff to a
 * completion certificate carrying the student's name.
 */

const getGradeSheet = vi.fn();
const saveScores = vi.fn();
const getTermReport = vi.fn();
const saveTermReport = vi.fn();
const publishTermReport = vi.fn();
const unpublishTermReport = vi.fn();

vi.mock("@/lib/grades-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grades-api")>()),
  getGradeSheet: (g: string) => getGradeSheet(g),
  saveScores: (g: string, a: string, s: unknown) => saveScores(g, a, s),
  getTermReport: (g: string, s: string) => getTermReport(g, s),
  saveTermReport: (g: string, s: string, i: unknown) => saveTermReport(g, s, i),
  publishTermReport: (g: string, s: string) => publishTermReport(g, s),
  unpublishTermReport: (g: string, s: string) => unpublishTermReport(g, s),
}));

const SHEET: Sheet = {
  members: [
    { student_id: "s-adam", full_name: "Adam", level: "A1", joined_on: "2026-06-01", left_on: null, left: false },
    { student_id: "s-celine", full_name: "Celine", level: null, joined_on: "2026-05-01", left_on: "2026-06-10", left: true },
  ],
  assessments: [
    { id: "a-quiz", group_id: "g1", title: "Quiz 1", kind: "QUIZ", held_on: "2026-06-03", max_score: 10, weight: 1, sort_order: 1, graded_count: 1 },
    { id: "a-mid", group_id: "g1", title: "Mid-term", kind: "MIDTERM", held_on: null, max_score: 50, weight: 2, sort_order: 2, graded_count: 0 },
  ],
  scores: {
    "s-adam": {
      "a-quiz": { assessment_id: "a-quiz", title: "Quiz 1", kind: "QUIZ", held_on: "2026-06-03", max_score: 10, weight: 1, score: 8, absent: false, note: null, percent: 80 },
      "a-mid": { assessment_id: "a-mid", title: "Mid-term", kind: "MIDTERM", held_on: null, max_score: 50, weight: 2, score: null, absent: false, note: null, percent: null },
    },
    "s-celine": {
      "a-quiz": { assessment_id: "a-quiz", title: "Quiz 1", kind: "QUIZ", held_on: "2026-06-03", max_score: 10, weight: 1, score: null, absent: true, note: null, percent: 0 },
      "a-mid": { assessment_id: "a-mid", title: "Mid-term", kind: "MIDTERM", held_on: null, max_score: 50, weight: 2, score: null, absent: false, note: null, percent: null },
    },
  },
  totals: { "s-adam": 80, "s-celine": 0 },
  can_mark: true,
  can_publish: true,
};

const REPORT: TermReportResponse = {
  report: {
    student: { id: "s-adam", full_name: "Adam Hassan", level: "A1" },
    group: { id: "g1", name: "English A1", level: "A1", teacher_name: "Miss Mona" },
    period: { from: "2026-06-01", to: "2026-06-17", left: false },
    attendance: { present: 1, late: 1, absent: 1, excused: 0, rate: 67, lessons_held: 3 },
    grades: [
      { assessment_id: "a-quiz", title: "Quiz 1", kind: "QUIZ", held_on: "2026-06-03", max_score: 10, weight: 1, score: 8, absent: false, note: null, percent: 80 },
      { assessment_id: "a-mid", title: "Mid-term", kind: "MIDTERM", held_on: null, max_score: 50, weight: 2, score: 40, absent: false, note: null, percent: 80 },
    ],
    total: { weighted_percent: 80 },
    comment: null,
    overall_grade: null,
    published_at: null,
    published_by_name: null,
    updated_at: null,
  },
  academy: { name: "Lingo Centre", logo_url: null },
  can_mark: true,
  can_publish: true,
};

const centreSession = () =>
  makeSession("ACADEMY_OWNER", {
    permissions: ["group.read", "group.manage", "certificate.read", "student.read"],
    capabilities: ["groups", "centre", "certificates"],
  });

beforeEach(() => {
  vi.clearAllMocks();
  getGradeSheet.mockResolvedValue(SHEET);
  saveScores.mockResolvedValue(SHEET);
  getTermReport.mockResolvedValue(REPORT);
  saveTermReport.mockResolvedValue(REPORT);
  publishTermReport.mockResolvedValue({ ...REPORT, report: { ...REPORT.report, published_at: "2026-06-17T10:00:00Z" } });
  unpublishTermReport.mockResolvedValue(REPORT);
});

describe("GradeSheet", () => {
  it("draws students × assessments with percents and totals, a left member flagged", async () => {
    render(withAuth(centreSession(), <GradeSheet groupId="g1" />));

    const table = await screen.findByTestId("grade-table");
    expect(within(table).getByTestId("assessment-col-a-quiz")).toHaveTextContent("Quiz 1");
    expect(within(table).getByTestId("assessment-col-a-quiz")).toHaveTextContent("من 10");
    expect(within(table).getByTestId("assessment-col-a-mid")).toHaveTextContent("الوزن 2");

    const adam = within(table).getByTestId("grade-row-s-adam");
    expect(within(adam).getByTestId("cell-s-adam-a-quiz")).toHaveValue(8);
    expect(adam).toHaveTextContent("80%");

    const celine = within(table).getByTestId("grade-row-s-celine");
    expect(celine).toHaveTextContent("(غادر)");
    expect(within(celine).getByTestId("cell-s-celine-a-quiz-absent")).toHaveAttribute("aria-pressed", "true");
    expect(within(celine).getByTestId("cell-s-celine-a-quiz")).toBeDisabled();
  });

  it("saves one column as a whole: typed scores, the absence, and the empty cells", async () => {
    render(withAuth(centreSession(), <GradeSheet groupId="g1" />));
    await screen.findByTestId("grade-table");

    // Nothing to save until something changes.
    expect(screen.queryByTestId("save-col-a-mid")).not.toBeInTheDocument();

    const adamMid = screen.getByTestId("cell-s-adam-a-mid");
    await userEvent.type(adamMid, "42");
    await userEvent.click(screen.getByTestId("cell-s-celine-a-mid-absent"));

    expect(screen.getByTestId("grades-save-all")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("save-col-a-mid"));

    await waitFor(() => expect(saveScores).toHaveBeenCalledTimes(1));
    expect(saveScores).toHaveBeenCalledWith("g1", "a-mid", [
      { student_id: "s-adam", score: 42, absent: false },
      { student_id: "s-celine", score: null, absent: true },
    ]);
    expect(await screen.findByText("تم حفظ الدرجات.")).toBeInTheDocument();
  });

  it("is read-only for someone who may not grade the group", async () => {
    getGradeSheet.mockResolvedValue({ ...SHEET, can_mark: false, can_publish: false });
    render(withAuth(makeSession("TEACHER", { capabilities: ["groups", "centre"] }), <GradeSheet groupId="g1" />));

    await screen.findByTestId("grade-table");
    expect(screen.queryByTestId("assessment-add")).not.toBeInTheDocument();
    expect(screen.getByTestId("cell-s-adam-a-quiz")).toBeDisabled();
    expect(screen.queryByTestId("cell-s-adam-a-quiz-absent")).not.toBeInTheDocument();
    expect(screen.getByText("يمكنك قراءة الدرجات؛ إدخالها لمدرّس المجموعة أو الإدارة.")).toBeInTheDocument();
  });
});

describe("TermReportView", () => {
  it("lays the report out, saves the comment with the publish, and links the certificate with the name filled in", async () => {
    const onBack = vi.fn();
    render(withAuth(centreSession(), <TermReportView groupId="g1" studentId="s-adam" onBack={onBack} />));

    expect(await screen.findByTestId("report-student")).toHaveTextContent("Adam Hassan");
    expect(screen.getByTestId("report-attendance")).toHaveTextContent("67%");
    expect(screen.getByTestId("report-grades")).toHaveTextContent("Quiz 1");
    expect(screen.getByTestId("report-total")).toHaveTextContent("80%");
    expect(screen.getByTestId("report-publish-state")).toHaveTextContent("غير منشور");
    expect(document.body.classList.contains("print-isolate")).toBe(true);

    // The certificate button goes to the gallery with the recipient in the query.
    const link = screen.getByTestId("report-certificate");
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/certificates?")).toBe(true);
    const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(q.get("recipient")).toBe("Adam Hassan");
    expect(q.get("course")).toBe("English A1 — A1");
    expect(q.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Type a comment, publish: the comment is saved first, then the report goes out.
    await userEvent.type(screen.getByTestId("report-comment"), "Well done");
    await userEvent.type(screen.getByTestId("report-overall"), "A");
    await userEvent.click(screen.getByTestId("report-publish"));

    await waitFor(() => expect(publishTermReport).toHaveBeenCalledWith("g1", "s-adam"));
    expect(saveTermReport).toHaveBeenCalledWith("g1", "s-adam", { comment: "Well done", overall_grade: "A" });
    expect(await screen.findByText("إلغاء النشر")).toBeInTheDocument();
    expect(screen.getByTestId("report-publish-state")).toHaveTextContent("منشور لولي الأمر");
  });

  it("hides publish from a teacher and the certificate without the switch", async () => {
    getTermReport.mockResolvedValue({ ...REPORT, can_publish: false });
    render(
      withAuth(
        makeSession("TEACHER", { permissions: ["group.read", "session.mark_attendance"], capabilities: ["groups", "centre"] }),
        <TermReportView groupId="g1" studentId="s-adam" onBack={() => {}} />,
      ),
    );

    await screen.findByTestId("report-student");
    expect(screen.queryByTestId("report-publish")).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-certificate")).not.toBeInTheDocument();
    expect(screen.getByTestId("report-save")).toBeInTheDocument();
  });
});

describe("certificateHref", () => {
  it("encodes the recipient, the course and the date", () => {
    expect(certificateHref("أحمد علي", "English A1", "2026-06-17")).toBe("/certificates?recipient=%D8%A3%D8%AD%D9%85%D8%AF+%D8%B9%D9%84%D9%8A&course=English+A1&date=2026-06-17");
  });
});
