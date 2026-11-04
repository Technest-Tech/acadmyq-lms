import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PortalChild, PortalPayload, PortalTermReport } from "@/lib/portal-api";
import { ParentPage } from "./parent-page";

// A centre's published term reports on the parent's page (docs/centre-profile, Phase 2 §5): the
// card appears only when the payload carries `term_reports`; a payload without the key — a Quran
// academy's, or a centre's before anything is published — draws nothing new.

const NOW = Date.parse("2026-06-17T09:00:00Z");

function child(overrides: Partial<PortalChild>): PortalChild {
  return {
    id: "adam",
    name: "Adam",
    teachers: [],
    groups: [],
    packages: [],
    month: { attended: 0, absent: 0, minutes: 0 },
    next_lesson: null,
    ...overrides,
  };
}

const REPORT: PortalTermReport = {
  group_id: "g1",
  group_name: "English A1",
  level: "A1",
  teacher_name: "Miss Mona",
  period: { from: "2026-06-01", to: "2026-06-17", left: false },
  attendance: { present: 1, late: 1, absent: 1, excused: 0, rate: 67, lessons_held: 3 },
  grades: [
    { title: "Quiz 1", kind: "QUIZ", held_on: "2026-06-03", max_score: 10, weight: 1, score: 8, absent: false, percent: 80 },
    { title: "Mid-term", kind: "MIDTERM", held_on: null, max_score: 50, weight: 2, score: null, absent: true, percent: 0 },
  ],
  total: { weighted_percent: 26.7 },
  comment: "Well done Adam, keep revising the tenses.",
  overall_grade: "B+",
  published_at: "2026-06-16T10:00:00Z",
};

const BASE: PortalPayload = {
  academy: { name: "Lingo Centre", logo_url: null, timezone: "Africa/Cairo" },
  guardian: { name: "Umm Adam" },
  children: [
    child({ group_lessons: { upcoming: [], recent: [] }, attendance_summary: { present: 0, late: 0, absent: 0, excused: 0, rate: null } }),
    child({ id: "sara", name: "Sara", group_lessons: { upcoming: [], recent: [] } }),
  ],
  upcoming: [],
  recent: [],
  progress_reports: [],
  invoices: [],
  balance: [],
};

describe("ParentPage term reports", () => {
  it("draws nothing of reports when no child carries one", () => {
    render(<ParentPage data={BASE} initialLang="en" renderedAt={NOW} />);
    expect(screen.queryByTestId("parent-term-reports")).not.toBeInTheDocument();
    expect(screen.queryByText("Term reports")).not.toBeInTheDocument();
  });

  it("shows a published report per child: period, attendance, the grades table, total, grade and comment", () => {
    const data: PortalPayload = { ...BASE, children: [{ ...BASE.children[0]!, term_reports: [REPORT] }, BASE.children[1]!] };
    render(<ParentPage data={data} initialLang="en" renderedAt={NOW} />);

    const section = screen.getByTestId("parent-term-reports");
    const cards = within(section).getAllByTestId("parent-term-report");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card).toHaveTextContent("Adam's report");
    expect(card).toHaveTextContent("English A1 · Level: A1 · with Miss Mona");
    expect(card).toHaveTextContent("1 June 2026 to 17 June 2026");
    expect(within(card).getByTestId("parent-overall-grade")).toHaveTextContent("B+");
    expect(within(card).getByTestId("parent-attendance-rate")).toHaveTextContent("67%");
    expect(within(card).getByTestId("parent-report-attendance")).toHaveTextContent("3 lessons");

    const grades = within(card).getByTestId("parent-report-grades");
    expect(grades).toHaveTextContent("Quiz 1");
    expect(grades).toHaveTextContent("8 / 10");
    expect(grades).toHaveTextContent("80%");
    expect(grades).toHaveTextContent("Mid-term");
    expect(grades).toHaveTextContent("Absent");
    expect(within(card).getByTestId("parent-report-total")).toHaveTextContent("26.7%");
    expect(within(card).getByTestId("parent-report-comment")).toHaveTextContent("Well done Adam, keep revising the tenses.");
    expect(card).toHaveTextContent("Published 16 June 2026");
  });

  it("reads in Arabic too", () => {
    const data: PortalPayload = { ...BASE, children: [{ ...BASE.children[0]!, term_reports: [REPORT] }] };
    render(<ParentPage data={data} initialLang="ar" renderedAt={NOW} />);
    const card = screen.getByTestId("parent-term-report");
    expect(card).toHaveTextContent("تقرير Adam");
    expect(card).toHaveTextContent("التقدير العام");
    expect(card).toHaveTextContent("تعليق المعلّم");
  });
});
