import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { BoardLesson, BoardMember } from "@/lib/groups-api";
import { LessonsBoard } from "./lessons-board";
import { PaymentsBoard } from "./payments-board";
import { StudentsBoard } from "./students-board";

/**
 * The Groups section's pages: lessons across every group (with the sheets still owed), every
 * student in every group (flags, and money only for money roles), and the month's payments.
 */

const listBoardLessons = vi.fn();
const listBoardMembers = vi.fn();
const getGroupPayments = vi.fn();

vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listBoardLessons: (p: unknown) => listBoardLessons(p),
  listBoardMembers: (p: unknown) => listBoardMembers(p),
  getGroupPayments: (m: unknown) => getGroupPayments(m),
  listGroups: () => Promise.resolve({ groups: [], counts: { RUNNING: 0, UPCOMING: 0, FINISHED: 0, ARCHIVED: 0 } }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: () => Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 200 }),
}));

const ar = arMessages.groups.board;
const HOUR = 3_600_000;

function boardLesson(id: string, offsetHours: number, over: Partial<BoardLesson> = {}): BoardLesson {
  const at = new Date(Date.now() + offsetHours * HOUR);
  return {
    id,
    group_id: "g1",
    teacher_id: "t1",
    teacher_name: "Mona",
    slot_id: "s1",
    occurrence_local_date: at.toISOString().slice(0, 10),
    scheduled_at_utc: at.toISOString(),
    duration_minutes: 60,
    status: "SCHEDULED",
    cancel_reason: null,
    moved: false,
    extra: false,
    topic: null,
    homework: null,
    notes: null,
    outcome_set_at: null,
    counts: { present: 0, late: 0, absent: 0, excused: 0, marked: 0, expected: 12 },
    group: { id: "g1", name: "English A1", level: "A1", timezone: "Africa/Cairo", mode: "ONLINE", location: null },
    ...over,
  };
}

function member(name: string, over: Partial<BoardMember> = {}): BoardMember {
  return {
    id: `m-${name}`,
    group_id: "g1",
    group_name: "English A1",
    group_level: "A1",
    teacher_id: "t1",
    teacher_name: "Mona",
    student_id: `s-${name}`,
    full_name: name,
    guardian_name: null,
    student_removed: false,
    joined_on: "2026-09-01",
    left_on: null,
    status: "ACTIVE",
    attendance: { present: 4, late: 0, absent: 0, excused: 0, marked: 4, rate: 1 },
    recent: ["PRESENT", "PRESENT"],
    absent_streak: 0,
    charge: null,
    ...over,
  };
}

describe("LessonsBoard — every group lesson, and the sheets still owed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the owed count on its tab, and lists the owed lessons oldest first", async () => {
    const owed = [boardLesson("old", -50), boardLesson("recent", -3)];
    listBoardLessons.mockImplementation(async (p: { view: string }) => ({
      view: p.view, from: "", to: "", timezone: "Africa/Cairo",
      lessons: p.view === "owed" ? owed : [boardLesson("later", +2)],
    }));
    const user = userEvent.setup();

    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.read", "session.mark_attendance"] }), <LessonsBoard />));

    await waitFor(() => expect(screen.getByTestId("lessons-view-owed")).toHaveTextContent("2"));
    expect(screen.getByTestId("board-lesson-later")).toBeInTheDocument();

    await user.click(screen.getByTestId("lessons-view-owed"));
    const list = await screen.findByTestId("board-lessons");
    await waitFor(() => expect(within(list).getByTestId("board-lesson-old")).toBeInTheDocument());
    expect(within(list).getByTestId("board-mark-old")).toHaveTextContent(arMessages.groups.lessons.takeAttendance);
    expect(listBoardLessons).toHaveBeenLastCalledWith(expect.objectContaining({ view: "owed" }));
  });

  it("offers no attendance button to someone who cannot mark", async () => {
    listBoardLessons.mockResolvedValue({ view: "day", from: "", to: "", timezone: "UTC", lessons: [boardLesson("x", -1)] });

    render(withAuth(makeSession("STAFF", { permissions: ["group.read"] }), <LessonsBoard />));

    await screen.findByTestId("board-lesson-x");
    expect(screen.queryByTestId("board-mark-x")).not.toBeInTheDocument();
  });
});

describe("StudentsBoard — every student in every group", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flags an absence streak and shows what is owed to a money role", async () => {
    listBoardMembers.mockResolvedValue({
      members: [
        member("Adam", { charge: { currency: "EGP", billed_minor: 45000, outstanding_minor: 45000 } }),
        member("Bassel", { absent_streak: 3, recent: ["ABSENT", "ABSENT", "ABSENT"], attendance: { present: 1, late: 0, absent: 3, excused: 0, marked: 4, rate: 0.25 } }),
      ],
      thresholds: { streak: 3, low_rate: 0.75 },
      sees_money: true,
    });

    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.read", "group.manage", "invoice.read"] }), <StudentsBoard />));

    const bassel = await screen.findByTestId("board-member-m-Bassel");
    expect(within(bassel).getByText(ar.students.streak.replace("{count}", "3"))).toBeInTheDocument();
    // Arabic money renders Arabic-Indic digits, so match the wording ("owes …"), not "450".
    expect(within(screen.getByTestId("board-member-m-Adam")).getByText(new RegExp(ar.students.owes.split("{amount}")[0]!.trim()))).toBeInTheDocument();
    expect(screen.getByTestId("board-flag-unpaid")).toBeInTheDocument();
    expect(screen.getByTestId("board-add-student")).toBeInTheDocument();
  });

  it("asks the server for the flag that was pressed", async () => {
    listBoardMembers.mockResolvedValue({ members: [member("Adam")], thresholds: { streak: 3, low_rate: 0.75 }, sees_money: false });
    const user = userEvent.setup();

    render(withAuth(makeSession("SUPERVISOR", { permissions: ["group.read"] }), <StudentsBoard />));
    await screen.findByTestId("board-member-m-Adam");

    // No money for this role: no unpaid chip, no add button without group.manage.
    expect(screen.queryByTestId("board-flag-unpaid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("board-add-student")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("board-flag-absent_streak"));
    await waitFor(() => expect(listBoardMembers).toHaveBeenLastCalledWith(expect.objectContaining({ flag: "absent_streak" })));
  });
});

describe("PaymentsBoard — the month's group money", () => {
  it("totals the month and lists every unpaid charge by name", async () => {
    getGroupPayments.mockResolvedValue({
      month: "2026-10",
      groups: [{ id: "g1", name: "English A1", level: "A1", teacher_name: "Mona", billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP",
        money: [{ currency: "EGP", billed_minor: 90000, paid_minor: 45000, outstanding_minor: 45000, charges: 2, teacher_cost_minor: 24000 }] }],
      totals: [{ currency: "EGP", billed_minor: 90000, paid_minor: 45000, outstanding_minor: 45000, teacher_cost_minor: 24000 }],
      unpaid: [{ line_id: "l1", group_id: "g1", group_name: "English A1", student_id: "s1", student_name: "Bassel", description: "English A1 — October 2026", amount_minor: 45000, currency: "EGP", invoice_status: "OPEN" }],
      sees_teacher_cost: true,
    });

    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["invoice.read", "payout.read"] }), <PaymentsBoard />));

    const totals = await screen.findByTestId("payments-totals");
    expect(within(totals).getByText(arMessages.groups.moneyTab.margin)).toBeInTheDocument();
    expect(within(screen.getByTestId("payments-unpaid")).getByText("Bassel")).toBeInTheDocument();
    expect(within(screen.getByTestId("payments-groups")).getByText("English A1")).toHaveAttribute("href", "/groups/g1?tab=money");
  });
});
