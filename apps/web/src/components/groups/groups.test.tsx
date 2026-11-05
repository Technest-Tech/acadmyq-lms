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

const getGroupDefaults = vi.fn(() => Promise.resolve({ defaults: {} as Record<string, unknown> }));
vi.mock("@/lib/group-defaults-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/group-defaults-api")>()),
  getGroupDefaults: () => getGroupDefaults(),
}));

const listRooms = vi.fn(() => Promise.resolve({ rooms: [] as unknown[] }));
vi.mock("@/lib/rooms-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rooms-api")>()),
  listRooms: () => listRooms(),
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

describe("GroupsManager — a learning centre's look", () => {
  const centreSession = () =>
    makeSession("ACADEMY_OWNER", {
      academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" },
      permissions: ["group.read", "group.manage"],
    });

  beforeEach(() => {
    vi.clearAllMocks();
    listGroups.mockResolvedValue({ groups: [groupRow()], counts: { RUNNING: 1, UPCOMING: 2, FINISHED: 0, ARCHIVED: 3 } });
  });

  it("reads the tabs as stat cards that still cut the list, and keeps the card's facts", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <GroupsManager />));

    const card = await screen.findByTestId("group-card-g1");
    expect(within(card).getByText("12 / 12")).toBeInTheDocument();
    expect(within(card).getByTestId("group-overdue")).toBeInTheDocument();
    expect(card).toHaveAttribute("href", "/groups/g1");

    // "All" counts every group that is not archived.
    expect(screen.getByTestId("segment-groups-ACTIVE")).toHaveTextContent("3");
    await user.click(screen.getByTestId("segment-groups-ARCHIVED"));
    await waitFor(() => expect(listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ state: "ARCHIVED" })));
    expect(screen.getByTestId("segment-groups-ARCHIVED")).toHaveAttribute("aria-pressed", "true");
  });

  it("joins days that share a time, counts the lessons in coloured blocks, and says how many seats are left", async () => {
    listGroups.mockResolvedValue({
      groups: [
        groupRow({
          capacity: 15,
          slots: [
            { weekday: 1, start_time_local: "17:00", duration_minutes: 60 },
            { weekday: 3, start_time_local: "17:00", duration_minutes: 60 },
          ],
        }),
      ],
      counts: { RUNNING: 1, UPCOMING: 0, FINISHED: 0, ARCHIVED: 0 },
    });
    render(withAuth(centreSession(), <GroupsManager />));

    const card = await screen.findByTestId("group-card-g1");
    // One line for Monday and Wednesday, not one each.
    expect(within(card).getByText(/الاثنين، الأربعاء/)).toBeInTheDocument();
    expect(within(card).getByText(ar.card.held).previousSibling).toHaveTextContent("4");
    expect(within(card).getByText(ar.card.upcoming).previousSibling).toHaveTextContent("6");
    expect(within(card).getByTestId("group-overdue")).toHaveTextContent("2");
    expect(within(card).getByText("متبقي 3")).toBeInTheDocument();
    // In reading order inside Arabic text: 12 of 15, not 15 of 12.
    expect(within(card).getByText("12 / 15")).toHaveAttribute("dir", "ltr");
  });

  it("leaves the sheets block quiet when none are owed", async () => {
    listGroups.mockResolvedValue({
      groups: [groupRow({ lessons: { held: 4, cancelled: 0, upcoming: 6, overdue: 0, next_lesson_at: null } })],
      counts: { RUNNING: 1, UPCOMING: 0, FINISHED: 0, ARCHIVED: 0 },
    });
    render(withAuth(centreSession(), <GroupsManager />));

    const card = await screen.findByTestId("group-card-g1");
    expect(within(card).queryByTestId("group-overdue")).toBeNull();
    expect(within(card).getByText(ar.noNextLesson)).toBeInTheDocument();
  });

  it("offers the first group from the empty page to someone who can make one", async () => {
    listGroups.mockResolvedValue({ groups: [], counts: { RUNNING: 0, UPCOMING: 0, FINISHED: 0, ARCHIVED: 0 } });
    render(withAuth(centreSession(), <GroupsManager />));

    expect(within(await screen.findByTestId("groups-empty")).getByRole("button", { name: ar.new })).toBeInTheDocument();
  });

  it("gives a Quran academy on the modern look the centre's stat cards and group cards", async () => {
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", {
          academy: { name: "Al-Huda", displayName: "Al-Huda", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "QURAN" },
          capabilities: ["groups", "modern_look"],
          permissions: ["group.read", "group.manage"],
        }),
        <GroupsManager />,
      ),
    );

    const card = await screen.findByTestId("group-card-g1");
    expect(screen.getByTestId("groups-tiles")).toBeInTheDocument();
    expect(screen.getByTestId("groups-filters")).toBeInTheDocument();
    expect(screen.queryByTestId("groups-tab-ACTIVE")).toBeNull();
    expect(within(card).getByTestId("group-overdue")).toBeInTheDocument();
  });

  it("keeps the old tabs and card for every other academy", async () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.read"] }), <GroupsManager />));

    await screen.findByTestId("group-card-g1");
    expect(screen.getByTestId("groups-tab-ACTIVE")).toBeInTheDocument();
    expect(screen.queryByTestId("groups-tiles")).toBeNull();
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

  it("asks what a revenue share is of only on the accounts, and sends nothing extra off them", async () => {
    const user = userEvent.setup();
    const session = (capabilities: string[]) => makeSession("ACADEMY_OWNER", { capabilities, permissions: ["group.read", "group.manage", "student.set_price", "teacher.set_pay"] });

    const { unmount } = render(withAuth(session(["groups", "invoicing"]), <GroupForm onCancel={vi.fn()} onSaved={vi.fn()} />));
    await user.selectOptions(await screen.findByTestId("group-pay-mode"), "REVENUE_SHARE");
    expect(screen.queryByTestId("group-share-basis")).toBeNull();
    unmount();

    render(withAuth(session(["groups", "invoicing", "accounting"]), <GroupForm onCancel={vi.fn()} onSaved={vi.fn()} />));
    await user.selectOptions(await screen.findByTestId("group-pay-mode"), "REVENUE_SHARE");
    const basis = screen.getByTestId("group-share-basis") as HTMLSelectElement;
    // Billed stays the default: nobody's pay moves unless someone chooses.
    expect(basis.value).toBe("BILLED");
    await user.selectOptions(basis, "COLLECTED");
    expect(screen.getByText(arMessages.groups.money.shareBasisHint.COLLECTED)).toBeTruthy();
  });

  it("gives a centre's form its sections and a live summary, and sends the same thing", async () => {
    const user = userEvent.setup();
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", {
          academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" },
          permissions: ["group.manage", "student.set_price", "teacher.set_pay"],
        }),
        <GroupForm onSaved={() => {}} onCancel={() => {}} />,
      ),
    );

    expect(screen.getByRole("heading", { name: ar.form.sections.basics })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: ar.form.sections.schedule })).toBeInTheDocument();
    const summary = within(screen.getByTestId("group-form-summary"));
    expect(summary.getByText(ar.form.sections.summaryName)).toBeInTheDocument();

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    expect(summary.getByText("English A1")).toBeInTheDocument();
    expect(summary.getByText("Mona")).toBeInTheDocument();

    await user.type(screen.getByTestId("group-price"), "450");
    expect(summary.getByText(/٤٥٠/)).toBeInTheDocument();

    await user.click(screen.getByTestId("group-save"));
    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0]).toMatchObject({ name: "English A1", billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP" });
  });

  it("keeps the plain form, with no sections or summary, for every other academy", () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage", "student.set_price"] }), <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    expect(screen.queryByTestId("group-form-summary")).toBeNull();
    expect(screen.queryByRole("heading", { name: ar.form.sections.basics })).toBeNull();
    expect(screen.getByTestId("group-pricing")).toHaveClass("rounded-xl", "border", "p-3");
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

describe("The classification's word on the group pages", () => {
  const centre = (levelLabel?: "LEVEL" | "GRADE" | "YEAR") => {
    const session = makeSession("ACADEMY_OWNER", { permissions: ["group.read", "group.manage"], capabilities: ["groups", "centre"] });
    session.academy = { ...session.academy!, levelLabel };
    return session;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listGroups.mockResolvedValue({ groups: [groupRow({ level: null, specialization_name: null })], counts: { RUNNING: 1, UPCOMING: 0, FINISHED: 0, ARCHIVED: 0 } });
  });

  it("keeps every word as it was for an academy that never chose", async () => {
    const quran = makeSession("ACADEMY_OWNER", { permissions: ["group.read", "group.manage"] });
    const { unmount } = render(withAuth(quran, <GroupForm onSaved={() => {}} onCancel={() => {}} />));
    expect(screen.getByText("المستوى")).toBeInTheDocument();
    expect(screen.queryByText("الصف")).toBeNull();
    unmount();

    render(withAuth(quran, <GroupsManager />));
    expect(await screen.findByPlaceholderText("ابحث بالمجموعة أو المستوى أو المدرس")).toBeInTheDocument();
    expect(await screen.findByText("بدون مستوى")).toBeInTheDocument();
  });

  it("says grade on the form, the search and the card for a grade-keeping centre", async () => {
    const { unmount } = render(withAuth(centre("GRADE"), <GroupForm onSaved={() => {}} onCancel={() => {}} />));
    expect(screen.getByText("الصف")).toBeInTheDocument();
    expect(screen.queryByText("المستوى")).toBeNull();
    unmount();

    render(withAuth(centre("GRADE"), <GroupsManager />));
    expect(await screen.findByPlaceholderText("ابحث بالمجموعة أو الصف أو المدرس")).toBeInTheDocument();
    expect(await screen.findByText("بدون صف")).toBeInTheDocument();
  });
});

describe("GroupForm — a centre's group defaults", () => {
  const centre = () =>
    makeSession("ACADEMY_OWNER", { permissions: ["group.manage", "student.set_price", "teacher.set_pay"], capabilities: ["groups", "centre"] });
  const DEFAULTS = {
    lesson_minutes: 90,
    mode: "ONLINE",
    billing_mode: "PER_LESSON",
    month_lessons: 8,
    teacher_pay_mode: "PER_LESSON",
    teacher_pay_minor: 15000,
    teacher_share_bp: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createGroup.mockResolvedValue({ group: { id: "new" }, generated: { created: 0, removed: 0 } });
    getGroupDefaults.mockResolvedValue({ defaults: DEFAULTS });
  });

  it("opens a new group on them", async () => {
    render(withAuth(centre(), <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await waitFor(() => expect(screen.getByTestId("group-duration")).toHaveValue("90"));
    expect(screen.getByRole("radio", { name: ar.mode.ONLINE })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("billing-PER_LESSON")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("group-pay-mode")).toHaveValue("PER_LESSON");
    expect(screen.getByTestId("group-pay-amount")).toHaveValue("150");
  });

  it("shows a default length off the list as Other", async () => {
    getGroupDefaults.mockResolvedValue({ defaults: { ...DEFAULTS, lesson_minutes: 75 } });
    render(withAuth(centre(), <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    expect(await screen.findByTestId("group-duration-other")).toHaveValue(75);
    expect(screen.getByTestId("group-duration")).toHaveValue("other");
  });

  it("never overwrites what was typed or picked before they arrive", async () => {
    const user = userEvent.setup();
    let arrive: (v: { defaults: Record<string, unknown> }) => void = () => {};
    getGroupDefaults.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    render(withAuth(centre(), <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.selectOptions(screen.getByTestId("group-duration"), "45");
    await user.click(screen.getByRole("radio", { name: ar.mode.OFFLINE }));
    await user.click(screen.getByTestId("billing-COURSE"));
    await user.selectOptions(screen.getByTestId("group-pay-mode"), "PER_STUDENT");
    await user.type(screen.getByTestId("group-pay-amount"), "20");

    arrive({ defaults: DEFAULTS });
    await waitFor(() => expect(getGroupDefaults).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByTestId("group-duration")).toHaveValue("45");
    expect(screen.getByRole("radio", { name: ar.mode.OFFLINE })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("billing-COURSE")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("group-pay-mode")).toHaveValue("PER_STUDENT");
    expect(screen.getByTestId("group-pay-amount")).toHaveValue("20");
  });

  it("leaves an edit on the group's own values, and never asks", async () => {
    const group = {
      ...groupRow({ mode: "OFFLINE", slots: [{ weekday: 1, start_time_local: "17:00", duration_minutes: 45 }] }),
      notes: null,
      effective_meeting_url: null,
      members: [],
      attendance_rate: null,
    } as GroupDetail;
    render(withAuth(centre(), <GroupForm group={group} onSaved={() => {}} onCancel={() => {}} />));

    expect(screen.getByTestId("group-duration")).toHaveValue("45");
    await new Promise((r) => setTimeout(r, 0));
    expect(getGroupDefaults).not.toHaveBeenCalled();
    expect(screen.getByTestId("group-duration")).toHaveValue("45");
  });

  it("does not ask for an academy without the centre switch: its form is unchanged", async () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage"] }), <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await new Promise((r) => setTimeout(r, 0));
    expect(getGroupDefaults).not.toHaveBeenCalled();
    expect(screen.getByTestId("group-duration")).toHaveValue("60");
    expect(screen.getByRole("radio", { name: ar.mode.ONLINE })).toHaveAttribute("aria-checked", "true");
  });
});

describe("GroupForm — a centre's room comes from its list", () => {
  const centre = () =>
    makeSession("ACADEMY_OWNER", { permissions: ["group.manage"], capabilities: ["groups", "centre"] });

  beforeEach(() => {
    vi.clearAllMocks();
    createGroup.mockResolvedValue({ group: { id: "new" }, generated: { created: 0, removed: 0 } });
    getGroupDefaults.mockResolvedValue({ defaults: {} });
    listRooms.mockResolvedValue({
      rooms: [
        { id: "r1", name: "Room 1", capacity: 12, position: 1, is_active: true, groups_count: 0 },
        { id: "r2", name: "Old hall", capacity: null, position: 2, is_active: false, groups_count: 0 },
      ],
    });
  });

  it("picks the room from the list, offers the Settings link, and sends its id", async () => {
    const user = userEvent.setup();
    render(withAuth(centre(), <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    const select = await screen.findByTestId("group-room");
    await waitFor(() => expect(select).not.toBeDisabled());
    // The switched-off room is not offered for a new placement.
    expect(within(select).queryByText("Old hall")).toBeNull();
    expect(screen.getByTestId("group-room-add")).toHaveAttribute("href", "/settings");
    expect(screen.queryByPlaceholderText(ar.form.locationPlaceholder)).toBeNull();

    await user.type(screen.getByTestId("group-name"), "English A1");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await user.selectOptions(select, "r1");
    await user.click(screen.getByTestId("group-save"));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0]![0]).toMatchObject({ mode: "OFFLINE", room_id: "r1", location: null });
  });

  it("keeps the typed room as free text for every other academy", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.manage"] }), <GroupForm onSaved={() => {}} onCancel={() => {}} />));

    await user.type(screen.getByTestId("group-name"), "Hifz");
    await user.click(screen.getByTestId("group-teacher"));
    await user.click(await screen.findByText("Mona"));
    await user.click(screen.getByRole("radio", { name: ar.mode.OFFLINE }));
    await user.type(screen.getByPlaceholderText(ar.form.locationPlaceholder), "Masjid hall");
    await user.click(screen.getByTestId("group-save"));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    const input = createGroup.mock.calls[0]![0];
    expect(input).toMatchObject({ mode: "OFFLINE", location: "Masjid hall" });
    expect(input).not.toHaveProperty("room_id");
    expect(screen.queryByTestId("group-room")).toBeNull();
    expect(listRooms).not.toHaveBeenCalled();
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
