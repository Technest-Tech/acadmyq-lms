import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { GroupDetail, GroupLesson, GroupLessonSheet, GroupRow } from "@/lib/groups-api";
import { AttendanceSheet } from "./attendance-sheet";
import { GroupLessonsPanel } from "./group-lessons-panel";
import { GroupForm } from "./group-form";
import { AddMembersForm } from "./group-members-panel";
import { GroupsManager } from "./groups-manager";

/**
 * Group classes (docs/groups): the list of groups, the attendance sheet ("everyone present, tap
 * the exceptions"), and the lessons tab that puts the sheets still owed on top.
 */

const listGroups = vi.fn();
const getGroupLesson = vi.fn();
const saveGroupAttendance = vi.fn();
const removeFromGroupLesson = vi.fn();
const listGroupLessons = vi.fn();
const createGroup = vi.fn();

vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listGroups: (p: unknown) => listGroups(p),
  getGroupLesson: (id: string) => getGroupLesson(id),
  saveGroupAttendance: (id: string, input: unknown) => saveGroupAttendance(id, input),
  removeFromGroupLesson: (id: string, studentId: string) => removeFromGroupLesson(id, studentId),
  listGroupLessons: (id: string, p: unknown) => listGroupLessons(id, p),
  createGroup: (input: unknown) => createGroup(input),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: () => Promise.resolve({ rows: [{ id: "t1", full_name: "Mona", session_rate_minor: 6000, pay_type: "HOURLY", currency: "EGP" }], total: 1, page: 1, pageSize: 200 }),
  listSpecializations: () => Promise.resolve({ specializations: [] }),
  listStudents: () =>
    Promise.resolve({
      rows: [
        { id: "s-adam", full_name: "Adam", whatsapp_phone: "+201001112222", secondary_phone: null, guardian_name: "Hassan", guardian_phone: "+201009998888", is_self_guardian: false },
        { id: "s-dina", full_name: "Dina", whatsapp_phone: null, secondary_phone: null, guardian_name: "Mariam", guardian_phone: "+201005556666", is_self_guardian: false },
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/groups",
  useSearchParams: () => new URLSearchParams(),
}));

const ar = arMessages.groups;
const TZ = "Africa/Cairo";
const HOUR = 3_600_000;

function groupRow(over: Partial<GroupRow> = {}): GroupRow {
  return {
    id: "g1",
    name: "English A1",
    specialization_id: null,
    specialization_name: "English",
    level: "A1",
    teacher_id: "t1",
    teacher_name: "Mona",
    capacity: 12,
    member_count: 12,
    mode: "ONLINE",
    location: null,
    meeting_url: null,
    timezone: TZ,
    start_date: "2026-09-01",
    end_date: null,
    status: "ACTIVE",
    state: "RUNNING",
    slots: [{ weekday: 1, start_time_local: "17:00", duration_minutes: 60 }],
    lessons: { held: 4, cancelled: 0, upcoming: 6, overdue: 2, next_lesson_at: new Date(Date.now() + 24 * HOUR).toISOString() },
    pricing: null,
    teacher_pay: null,
    ...over,
  };
}

function lesson(id: string, offsetHours: number, over: Partial<GroupLesson> = {}): GroupLesson {
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
    counts: { present: 0, late: 0, absent: 0, excused: 0, marked: 0, expected: 3 },
    ...over,
  };
}

function sheet(offsetHours: number): GroupLessonSheet {
  return {
    lesson: lesson("l1", offsetHours),
    group: { id: "g1", name: "English A1", level: "A1", timezone: TZ, status: "ACTIVE", mode: "ONLINE", location: null, meeting_url: null },
    roster: [
      { student_id: "s-adam", full_name: "Adam", status: null, note: null, member: true },
      { student_id: "s-dina", full_name: "Dina", status: null, note: null, member: true },
      { student_id: "s-omar", full_name: "Omar", status: null, note: null, member: true },
    ],
  };
}

describe("GroupsManager — the groups page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listGroups.mockResolvedValue({
      groups: [groupRow()],
      counts: { RUNNING: 1, UPCOMING: 2, FINISHED: 0, ARCHIVED: 3 },
    });
  });

  it("shows each group as a card with its seats, overdue sheets and tab counts", async () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.read", "group.manage"] }), <GroupsManager />));

    const card = await screen.findByTestId("group-card-g1");
    expect(within(card).getByText("English A1")).toBeInTheDocument();
    expect(within(card).getByText("12 / 12")).toBeInTheDocument();
    expect(card).toHaveAttribute("href", "/groups/g1");
    // Two sheets owed — the red flag on the card.
    expect(within(card).getByTestId("group-overdue")).toBeInTheDocument();

    // "All" counts every group that is not archived; the archived tab keeps its own count.
    expect(screen.getByTestId("groups-tab-ACTIVE")).toHaveTextContent("3");
    expect(screen.getByTestId("groups-tab-ARCHIVED")).toHaveTextContent("3");
    expect(screen.getByTestId("groups-new")).toHaveTextContent(ar.new);
  });

  it("asks the server for the state behind the tab", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.read"] }), <GroupsManager />));
    await screen.findByTestId("group-card-g1");

    await user.click(screen.getByTestId("groups-tab-ARCHIVED"));
    await waitFor(() => expect(listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ state: "ARCHIVED" })));
  });

  it("offers no 'New group' to someone who can only read", async () => {
    render(withAuth(makeSession("TEACHER", { permissions: ["group.read"] }), <GroupsManager />));
    await screen.findByTestId("group-card-g1");

    expect(screen.queryByTestId("groups-new")).not.toBeInTheDocument();
  });
});

describe("AttendanceSheet — everyone present, tap the exceptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveGroupAttendance.mockImplementation(async () => sheet(-1));
  });

  it("starts everyone present and sends the absentee with the rest", async () => {
    getGroupLesson.mockResolvedValue(sheet(-1));
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(withAuth(makeSession("TEACHER", { permissions: ["group.read", "session.mark_attendance"] }),
      <AttendanceSheet lessonId="l1" onSaved={onSaved} onCancel={() => {}} />));

    await screen.findByTestId("attendance-sheet");
    expect(screen.getByTestId("mark-s-adam-PRESENT")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mark-s-dina-PRESENT")).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByTestId("mark-s-dina-ABSENT"));
    await user.type(screen.getByLabelText(ar.sheet.topic), "Unit 3");
    await user.click(screen.getByTestId("sheet-save"));

    await waitFor(() => expect(saveGroupAttendance).toHaveBeenCalledTimes(1));
    const [id, input] = saveGroupAttendance.mock.calls[0]!;
    expect(id).toBe("l1");
    expect(input.entries).toEqual([
      { student_id: "s-adam", status: "PRESENT", note: null },
      { student_id: "s-dina", status: "ABSENT", note: null },
      { student_id: "s-omar", status: "PRESENT", note: null },
    ]);
    expect(input.topic).toBe("Unit 3");
    expect(input.override_timing).toBeUndefined();
    expect(onSaved).toHaveBeenCalled();
  });

  it("will not let a teacher mark a lesson that has not started", async () => {
    getGroupLesson.mockResolvedValue(sheet(+3));

    render(withAuth(makeSession("TEACHER", { permissions: ["group.read", "session.mark_attendance"] }),
      <AttendanceSheet lessonId="l1" onSaved={() => {}} onCancel={() => {}} />));

    await screen.findByTestId("attendance-sheet");
    expect(screen.getByText(ar.sheet.notStarted)).toBeInTheDocument();
    expect(screen.queryByText(ar.sheet.recordAnyway)).not.toBeInTheDocument();
    expect(screen.getByTestId("sheet-save")).toBeDisabled();
  });

  it("lets an owner record a lesson ahead, and says so to the server", async () => {
    getGroupLesson.mockResolvedValue(sheet(+3));
    const user = userEvent.setup();

    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.read", "session.mark_attendance"] }),
      <AttendanceSheet lessonId="l1" onSaved={() => {}} onCancel={() => {}} />));

    await screen.findByTestId("attendance-sheet");
    expect(screen.getByTestId("sheet-save")).toBeDisabled();
    await user.click(screen.getByLabelText(ar.sheet.recordAnyway));
    await user.click(screen.getByTestId("sheet-save"));

    await waitFor(() => expect(saveGroupAttendance).toHaveBeenCalled());
    expect(saveGroupAttendance.mock.calls[0]![1].override_timing).toBe(true);
  });

  it("takes a student off this lesson after asking, and keeps the unsaved taps on the others", async () => {
    getGroupLesson.mockResolvedValue(sheet(-1));
    const without = sheet(-1);
    without.roster = without.roster.filter((r) => r.student_id !== "s-dina");
    removeFromGroupLesson.mockResolvedValue(without);
    const user = userEvent.setup();

    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.read", "group.manage", "session.mark_attendance"] }),
      <AttendanceSheet lessonId="l1" onSaved={() => {}} onCancel={() => {}} />));

    await screen.findByTestId("attendance-sheet");
    await user.click(screen.getByTestId("mark-s-omar-ABSENT"));
    await user.click(screen.getByTestId("sheet-remove-s-dina"));
    expect(removeFromGroupLesson).not.toHaveBeenCalled(); // asks first
    await user.click(screen.getByTestId("sheet-remove-confirm-s-dina"));

    await waitFor(() => expect(removeFromGroupLesson).toHaveBeenCalledWith("l1", "s-dina"));
    await waitFor(() => expect(screen.queryByTestId("sheet-row-s-dina")).not.toBeInTheDocument());
    expect(screen.getByTestId("mark-s-omar-ABSENT")).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByTestId("sheet-save"));
    await waitFor(() => expect(saveGroupAttendance).toHaveBeenCalled());
    expect(saveGroupAttendance.mock.calls[0]![1].entries.map((e: { student_id: string }) => e.student_id)).toEqual(["s-adam", "s-omar"]);
  });

  it("offers no removal to someone who only marks", async () => {
    getGroupLesson.mockResolvedValue(sheet(-1));

    render(withAuth(makeSession("TEACHER", { permissions: ["group.read", "session.mark_attendance"] }),
      <AttendanceSheet lessonId="l1" onSaved={() => {}} onCancel={() => {}} />));

    await screen.findByTestId("attendance-sheet");
    expect(screen.queryByTestId("sheet-remove-s-dina")).not.toBeInTheDocument();
  });
});

describe("GroupLessonsPanel — the sheets still owed come first", () => {
  const group = { ...groupRow(), notes: null, effective_meeting_url: null, members: [], attendance_rate: null } as GroupDetail;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("puts a past pending lesson in the red section and a future one under upcoming", async () => {
    listGroupLessons.mockResolvedValue({
      lessons: [
        lesson("owed", -26),
        lesson("held", -50, { status: "HELD", counts: { present: 2, late: 0, absent: 1, excused: 0, marked: 3, expected: 3 } }),
        lesson("next", +20),
      ],
      from: "2026-09-01",
      to: "2026-11-30",
    });

    render(withAuth(makeSession("ACADEMY_OWNER", {
      permissions: ["group.read", "group.manage", "session.mark_attendance", "session.revert_attendance"],
    }), <GroupLessonsPanel group={group} onChanged={() => {}} />));

    const owed = await screen.findByTestId("lessons-owed");
    expect(within(owed).getByTestId("lesson-owed")).toBeInTheDocument();
    expect(within(owed).getByText(ar.lessonStatus.OVERDUE)).toBeInTheDocument();

    expect(within(screen.getByTestId("lessons-upcoming")).getByTestId("lesson-next")).toBeInTheDocument();
    const past = screen.getByTestId("lessons-past");
    expect(within(past).getByTestId("lesson-held")).toHaveTextContent("2");
    expect(within(past).getByTestId("lesson-mark-held")).toHaveTextContent(ar.lessons.editSheet);
  });

  it("shows no attendance button to someone who cannot mark", async () => {
    listGroupLessons.mockResolvedValue({ lessons: [lesson("owed", -26)], from: "", to: "" });

    render(withAuth(makeSession("STAFF", { permissions: ["group.read"] }), <GroupLessonsPanel group={group} onChanged={() => {}} />));

    await screen.findByTestId("lessons-owed");
    expect(screen.queryByTestId("lesson-mark-owed")).not.toBeInTheDocument();
  });
});

describe("GroupForm — what the student pays and what the teacher earns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createGroup.mockResolvedValue({ group: { id: "new" }, generated: { created: 0, removed: 0 } });
  });

  it("sends the price in minor units and a revenue share in basis points", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage", "student.set_price", "teacher.set_pay"] }),
      <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await user.type(screen.getByTestId("group-price"), "450");
    await user.selectOptions(screen.getByTestId("group-pay-mode"), "REVENUE_SHARE");
    await user.type(screen.getByTestId("group-share"), "40");
    await user.click(screen.getByTestId("group-save"));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    const input = createGroup.mock.calls[0]![0];
    expect(input).toMatchObject({
      billing_mode: "MONTHLY",
      price_minor: 45000,
      // Opens on the academy's own currency (EGP in the test session); "academy currency" is still a choice.
      currency: "EGP",
      teacher_pay_mode: "REVENUE_SHARE",
      teacher_pay_minor: null,
      teacher_share_bp: 4000,
    });
  });

  it("sells a monthly group by hours: the hours go up as minutes, and the join pro-rating drops away", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage", "student.set_price"] }),
      <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await user.type(screen.getByTestId("group-price"), "600");
    expect(screen.getByText(ar.money.prorateJoin)).toBeInTheDocument();
    await user.type(screen.getByTestId("group-month-hours"), "7.5");
    expect(screen.queryByText(ar.money.prorateJoin)).not.toBeInTheDocument();
    await user.click(screen.getByTestId("group-save"));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0]).toMatchObject({ billing_mode: "MONTHLY", price_minor: 60000, month_minutes: 450 });
  });

  it("a centre counts a month in lessons and prices it by the lesson: lessons, their length and price — the month's price is worked out", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage", "student.set_price"], capabilities: ["invoicing", "groups", "centre"] }),
      <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    // Lessons a month first — not hours; with them, the price is asked per lesson.
    expect(screen.queryByTestId("group-month-hours")).not.toBeInTheDocument();
    await user.type(screen.getByTestId("group-month-lessons"), "12");
    expect(screen.queryByTestId("group-price")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByTestId("group-lesson-unit"), "40");
    await user.type(screen.getByTestId("group-lesson-unit-price"), "90");
    // 12 lessons of 40 minutes × 90 = 1,080 a month; the month is kept as 480 minutes.
    expect(screen.getByTestId("group-lesson-total").textContent).toContain("12");
    await user.click(screen.getByTestId("group-save"));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0]).toMatchObject({ billing_mode: "MONTHLY", price_minor: 108000, month_minutes: 480 });
  });

  it("drops the hours when the group is not monthly", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage", "student.set_price"] }),
      <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await user.type(screen.getByTestId("group-month-hours"), "8");
    await user.click(screen.getByTestId("billing-PER_LESSON"));
    expect(screen.queryByTestId("group-month-hours")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("group-save"));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0]).toMatchObject({ billing_mode: "PER_LESSON", month_minutes: null });
  });

  it("shows a supervisor no money at all, and sends none", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("SUPERVISOR", { permissions: ["group.manage"] }),
      <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    expect(screen.queryByTestId("group-pricing")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-teacher-pay")).not.toBeInTheDocument();

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await user.click(screen.getByTestId("group-save"));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    const input = createGroup.mock.calls[0]![0];
    expect(input).not.toHaveProperty("price_minor");
    expect(input).not.toHaveProperty("teacher_pay_mode");
  });

  it("brings the teacher's own hourly rate in as a starting point, and never overwrites a typed amount", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage", "student.set_price", "teacher.set_pay"] }),
      <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await waitFor(() => expect((screen.getByTestId("group-pay-mode") as HTMLSelectElement).value).toBe("PER_HOUR"));
    expect((screen.getByTestId("group-pay-amount") as HTMLInputElement).value).toBe("60");

    await user.clear(screen.getByTestId("group-pay-amount"));
    await user.type(screen.getByTestId("group-pay-amount"), "75");
    await user.click(screen.getByTestId("group-save"));
    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0]).toMatchObject({ teacher_pay_mode: "PER_HOUR", teacher_pay_minor: 7500 });
  });

  it("offers the lesson lengths a centre runs as a list, 'Other' for the rest", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage"] }), <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await user.selectOptions(screen.getByTestId("group-duration"), "45");
    await user.click(screen.getByTestId("group-save"));
    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0].slots[0]).toMatchObject({ duration_minutes: 45 });

    // A length off the list is typed under "Other".
    createGroup.mockClear();
    await user.selectOptions(screen.getByTestId("group-duration"), "other");
    await user.clear(screen.getByTestId("group-duration-other"));
    await user.type(screen.getByTestId("group-duration-other"), "75");
    await user.click(screen.getByTestId("group-save"));
    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0].slots[0]).toMatchObject({ duration_minutes: 75 });
  });

  it("creates the class with its students, and says what a lesson alone counts against their hours", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage", "student.set_price"] }),
      <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await user.type(screen.getByTestId("group-price"), "600");
    await user.type(screen.getByTestId("group-month-hours"), "8");
    await user.type(await screen.findByTestId("group-solo-minutes"), "90");
    await user.click(await screen.findByTestId("pick-s-adam"));
    await user.click(screen.getByTestId("group-save"));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0]).toMatchObject({ student_ids: ["s-adam"], month_minutes: 480, solo_billed_minutes: 90 });
  });
});

describe("AddMembersForm — picking students for a group", () => {
  const group = { ...groupRow({ capacity: null, member_count: 0 }), notes: null, effective_meeting_url: null, members: [], attendance_rate: null } as GroupDetail;

  it("shows each student's number — their own, else the parent's — and finds them by it", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage"] }),
      <AddMembersForm group={group} onCancel={() => {}} onSaved={() => {}} />));

    expect(await screen.findByTestId("pick-phone-s-adam")).toHaveTextContent("+201001112222");
    expect(screen.getByTestId("pick-phone-s-dina")).toHaveTextContent("+201005556666");

    // Typed the local way, with the leading 0 and a space.
    await user.type(screen.getByLabelText(ar.members.searchStudents), "0100 555");
    expect(screen.queryByTestId("pick-s-adam")).not.toBeInTheDocument();
    expect(screen.getByTestId("pick-s-dina")).toBeInTheDocument();
  });
});
