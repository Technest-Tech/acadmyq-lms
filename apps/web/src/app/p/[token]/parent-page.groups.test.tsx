import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PortalChild, PortalPayload } from "@/lib/portal-api";
import { ParentPage } from "./parent-page";

// A CENTRE's parent page (docs/centre-profile, Phase 2 §4): the groups with their timetable, the
// 30-day marks, the week ahead, the latest sheets and the family's receipts account — all rendered
// from blocks the payload carries only for a centre. A Quran payload draws nothing new.

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

const BASE: PortalPayload = {
  academy: { name: "Lingo Centre", logo_url: null, timezone: "Africa/Cairo" },
  guardian: { name: "Umm Adam" },
  children: [child({})],
  upcoming: [],
  recent: [],
  progress_reports: [],
  invoices: [],
  balance: [],
};

const CENTRE: PortalPayload = {
  ...BASE,
  children: [
    child({
      groups: [
        {
          id: "g1",
          name: "English A1",
          teacher: "Miss Mona",
          teacher_name: "Miss Mona",
          level: "A1",
          joined_on: "2026-06-01",
          slots: [
            { weekday: 1, start_time_local: "17:00", duration_minutes: 60 },
            { weekday: 3, start_time_local: "17:00", duration_minutes: 60 },
          ],
        },
      ],
      group_lessons: {
        upcoming: [{ id: "u1", group_id: "g1", group_name: "English A1", starts_at: "2026-06-22T15:00:00Z", duration_minutes: 60, status: "SCHEDULED" }],
        recent: [
          { id: "r1", group_id: "g1", group_name: "English A1", starts_at: "2026-06-15T15:00:00Z", duration_minutes: 60, attendance: "PRESENT", topic: null, homework: null },
          { id: "r2", group_id: "g1", group_name: "English A1", starts_at: "2026-06-10T15:00:00Z", duration_minutes: 60, attendance: "ABSENT", topic: "Past simple", homework: "Page 12" },
          { id: "r3", group_id: "g1", group_name: "English A1", starts_at: "2026-06-08T15:00:00Z", duration_minutes: 60, attendance: null, topic: null, homework: null },
        ],
      },
      attendance_summary: { present: 1, late: 1, absent: 1, excused: 0, rate: 67 },
    }),
  ],
  balance: [{ currency: "EGP", due_minor: 70000 }],
  family_account: {
    currency: "EGP",
    due_minor: 70000,
    overdue_minor: 30000,
    credit_minor: 10000,
    recent_receipts: [
      { number: "R-000002", received_on: "2026-06-05", amount_minor: 10000, currency: "EGP", method: "INSTAPAY" },
      { number: "R-000001", received_on: "2026-05-10", amount_minor: 20000, currency: "EGP", method: "CASH" },
    ],
    pay_url: "https://lingo.acadmyq.com/f/tok",
  },
};

describe("ParentPage for a centre", () => {
  it("names the level in the centre's own word, in both languages", () => {
    const { unmount } = render(<ParentPage data={{ ...CENTRE, level_label: "GRADE" }} initialLang="en" renderedAt={NOW} />);
    expect(screen.getByTestId("parent-group")).toHaveTextContent("Grade: A1 · with Miss Mona");
    unmount();

    render(<ParentPage data={{ ...CENTRE, level_label: "YEAR" }} initialLang="ar" renderedAt={NOW} />);
    expect(screen.getByTestId("parent-group")).toHaveTextContent("السنة: A1");
  });

  it("draws the groups with their weekly times, the marks, the week ahead and the latest sheets", () => {
    render(<ParentPage data={CENTRE} initialLang="en" renderedAt={NOW} />);

    const section = screen.getByTestId("parent-groups");
    expect(within(section).getByText("Adam’s groups")).toBeInTheDocument();

    const group = within(section).getByTestId("parent-group");
    expect(group).toHaveTextContent("English A1");
    expect(group).toHaveTextContent("Level: A1 · with Miss Mona · since 1 June 2026");
    const slots = within(group).getAllByRole("listitem");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toHaveTextContent("Monday");
    expect(slots[0]).toHaveTextContent("17:00");
    expect(slots[0]).toHaveTextContent("60 min");
    expect(slots[1]).toHaveTextContent("Wednesday");

    expect(screen.getByTestId("parent-attendance-rate")).toHaveTextContent("67%");
    const attendance = screen.getByTestId("parent-attendance");
    expect(attendance).toHaveTextContent("Present1");
    expect(attendance).toHaveTextContent("Absent1");

    expect(screen.getByTestId("parent-group-upcoming")).toHaveTextContent("English A1");
    expect(screen.getByTestId("parent-group-upcoming")).not.toHaveTextContent("No lessons");

    const lessons = screen.getAllByTestId("parent-group-lesson");
    expect(lessons).toHaveLength(3);
    expect(lessons[0]).toHaveTextContent("Present");
    expect(lessons[1]).toHaveTextContent("Absent");
    expect(lessons[1]).toHaveTextContent("What was taught: Past simple");
    expect(lessons[1]).toHaveTextContent("Homework: Page 12");
    expect(lessons[2]).toHaveTextContent("Not recorded");
  });

  it("shows the family's account in the invoices tab — due, overdue, credit, receipts, and a pay button", async () => {
    render(<ParentPage data={CENTRE} initialLang="en" renderedAt={NOW} />);
    await userEvent.click(screen.getByTestId("parent-tab-invoices"));

    const account = screen.getByTestId("parent-account");
    expect(screen.getByTestId("parent-account-due")).toHaveTextContent("700");
    expect(screen.getByTestId("parent-account-overdue")).toHaveTextContent("300");
    expect(screen.getByTestId("parent-account-credit")).toHaveTextContent("100");
    expect(within(account).getByRole("link", { name: /Pay what is due/ })).toHaveAttribute("href", "https://lingo.acadmyq.com/f/tok");

    const receipts = screen.getAllByTestId("parent-receipt");
    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toHaveTextContent("Receipt R-000002");
    expect(receipts[0]).toHaveTextContent("5 June · InstaPay");
    expect(receipts[1]).toHaveTextContent("Cash");
  });

  it("reads in Arabic too — the day names and the marks", () => {
    render(<ParentPage data={CENTRE} initialLang="ar" renderedAt={NOW} />);

    expect(screen.getByTestId("parent-groups")).toHaveTextContent("مجموعات Adam");
    expect(within(screen.getByTestId("parent-group")).getAllByRole("listitem")[0]).toHaveTextContent("الاثنين");
    expect(screen.getAllByTestId("parent-group-lesson")[1]).toHaveTextContent("غاب");
  });

  it("has no Reports tab when neither Quran feed has anything — the term reports keep their own section", () => {
    render(<ParentPage data={CENTRE} initialLang="en" renderedAt={NOW} />);
    expect(screen.queryByTestId("parent-tab-reports")).not.toBeInTheDocument();
    expect(screen.getByTestId("parent-tab-lessons")).toBeInTheDocument();
    expect(screen.getByTestId("parent-tab-invoices")).toBeInTheDocument();
  });

  it("draws nothing new for a Quran family", async () => {
    render(<ParentPage data={BASE} initialLang="en" renderedAt={NOW} />);

    expect(screen.queryByTestId("parent-groups")).toBeNull();
    expect(screen.queryByTestId("parent-attendance")).toBeNull();

    await userEvent.click(screen.getByTestId("parent-tab-invoices"));
    expect(screen.queryByTestId("parent-account")).toBeNull();
    expect(screen.getByText("No invoices yet.")).toBeInTheDocument();
  });
});
