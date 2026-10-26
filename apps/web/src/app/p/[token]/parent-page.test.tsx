import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PortalLesson, PortalPayload } from "@/lib/portal-api";
import { ParentPage } from "./parent-page";

const NOW = Date.parse("2026-06-17T09:00:00Z");

function lesson(overrides: Partial<PortalLesson>): PortalLesson {
  return {
    id: "l1",
    child_id: "adam",
    kind: "PRIVATE",
    group_name: null,
    teacher: "Miss Mona",
    starts_at: "2026-06-18T14:00:00Z",
    duration_minutes: 45,
    status: "SCHEDULED",
    ...overrides,
  };
}

const DATA: PortalPayload = {
  academy: { name: "Nour Academy", logo_url: null, timezone: "Africa/Cairo" },
  guardian: { name: "Umm Adam" },
  children: [
    {
      id: "adam",
      name: "Adam",
      teachers: [{ name: "Miss Mona", course: "Quran" }],
      groups: [],
      packages: [{ label: "10 hours", course: null, total_minutes: 600, remaining_minutes: 420, expires_on: null }],
      month: { attended: 3, absent: 1, minutes: 135 },
      next_lesson: lesson({ id: "next" }),
    },
    {
      id: "sara",
      name: "Sara",
      teachers: [],
      groups: [{ name: "Tajweed Juniors", teacher: "Miss Mona" }],
      packages: [],
      month: { attended: 2, absent: 0, minutes: 120 },
      next_lesson: null,
    },
  ],
  upcoming: [lesson({ id: "next" }), lesson({ id: "sara-group", child_id: "sara", kind: "GROUP", group_name: "Tajweed Juniors", starts_at: "2026-06-19T15:00:00Z" })],
  recent: [
    lesson({
      id: "taken",
      starts_at: "2026-06-15T14:00:00Z",
      status: "ATTENDED",
      report: [
        { label_ar: "السورة", label_en: "Surah", type: "TEXT", value: "Al-Mulk" },
        { label_ar: "التقييم", label_en: "Rating", type: "RATING", value: "4" },
      ],
    }),
    lesson({ id: "missed", child_id: "sara", starts_at: "2026-06-14T14:00:00Z", status: "ABSENT", report: null }),
  ],
  progress_reports: [
    { id: "pr1", child_id: "adam", month: "2026-05", title: "May progress", body: "Memorised Juz Amma.", teacher: "Miss Mona" },
  ],
  invoices: [
    {
      id: "inv1",
      period_year: 2026,
      period_month: 5,
      state: "PARTIAL",
      running: false,
      currency: "EGP",
      total_minor: 60000,
      paid_minor: 20000,
      due_minor: 40000,
      lesson_count: 8,
      title: null,
      child_name: null,
      url: "https://nour.acadmyq.com/i/tok1",
    },
    {
      id: "inv2",
      period_year: 2026,
      period_month: 4,
      state: "PAID",
      running: false,
      currency: "EGP",
      total_minor: 50000,
      paid_minor: 50000,
      due_minor: 0,
      lesson_count: 0,
      title: "Package — 8 hours",
      child_name: "Sara",
      url: "https://nour.acadmyq.com/i/tok2",
    },
  ],
  balance: [{ currency: "EGP", due_minor: 40000 }],
};

function renderPage(lang: "ar" | "en" = "en") {
  render(<ParentPage data={DATA} initialLang={lang} renderedAt={NOW} />);
}

describe("ParentPage", () => {
  it("greets the family in Arabic, right to left, and switches to English in place", async () => {
    renderPage("ar");

    const hello = screen.getByTestId("parent-hello");
    expect(hello).toHaveTextContent("أهلاً، Umm Adam");
    expect(hello.closest("[dir]")).toHaveAttribute("dir", "rtl");

    await userEvent.click(screen.getByTestId("parent-lang"));

    expect(screen.getByTestId("parent-hello")).toHaveTextContent("Hello, Umm Adam");
    expect(screen.getByTestId("parent-hello").closest("[dir]")).toHaveAttribute("dir", "ltr");
  });

  it("shows a card per child with this month and the hours left on the package", () => {
    renderPage();

    const cards = screen.getAllByTestId("parent-child");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Adam")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Miss Mona · Quran")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("7 hours left of 10 hours")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Tajweed Juniors")).toBeInTheDocument();
    expect(screen.getByTestId("parent-balance")).toHaveTextContent("400");
  });

  it("narrows the lessons to one child", async () => {
    renderPage();
    expect(screen.getAllByTestId("parent-upcoming")).toHaveLength(2);
    expect(screen.getAllByTestId("parent-recent")).toHaveLength(2);

    await userEvent.click(within(screen.getByTestId("parent-child-filter")).getByRole("button", { name: /Sara/ }));

    expect(screen.getAllByTestId("parent-upcoming")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-recent")).toHaveLength(1);
    expect(screen.getByTestId("parent-recent")).toHaveTextContent("Absent");
  });

  it("lists the approved monthly report and each lesson report, a rating as stars", async () => {
    renderPage();
    await userEvent.click(screen.getByTestId("parent-tab-reports"));

    expect(screen.getByTestId("parent-progress-report")).toHaveTextContent("May progress");
    expect(screen.getByTestId("parent-progress-report")).toHaveTextContent("Memorised Juz Amma.");
    const report = screen.getByTestId("parent-lesson-report");
    expect(report).toHaveTextContent("Al-Mulk");
    expect(within(report).getByLabelText("4 / 5")).toBeInTheDocument();
  });

  it("shows what is due and pays each bill through its own invoice link", async () => {
    renderPage();
    await userEvent.click(screen.getByTestId("parent-tab-invoices"));

    const [may, april] = screen.getAllByTestId("parent-invoice");
    expect(may).toHaveTextContent("Partly paid");
    expect(within(may!).getByRole("link", { name: /Pay now/ })).toHaveAttribute("href", "https://nour.acadmyq.com/i/tok1");
    expect(april).toHaveTextContent("Package — 8 hours");
    expect(within(april!).getByRole("link", { name: /View/ })).toHaveAttribute("href", "https://nour.acadmyq.com/i/tok2");
  });
});
