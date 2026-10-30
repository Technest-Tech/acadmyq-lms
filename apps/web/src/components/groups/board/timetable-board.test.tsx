import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../../messages/ar.json";
import { todayIn } from "@/components/groups/group-format";
import { makeSession, withAuth } from "@/test/auth";
import type { BoardLesson, GroupRow } from "@/lib/groups-api";
import { LessonsBoard } from "./lessons-board";
import { roomClashes, toTimetableRow, weekStartOf } from "./timetable-board";

/**
 * A centre's timetable (2026-10-30, lingo's sheet): the week in hour blocks — every four o'clock
 * class together, with its subject, teacher and room — filters, a red room clash, and moving a
 * lesson once or its weekly time for good.
 */

const listBoardLessons = vi.fn();
const updateGroup = vi.fn();
const rescheduleGroupLesson = vi.fn();
let groups: GroupRow[] = [];

vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listBoardLessons: (p: unknown) => listBoardLessons(p),
  updateGroup: (id: string, input: unknown) => updateGroup(id, input),
  rescheduleGroupLesson: (id: string, input: unknown) => rescheduleGroupLesson(id, input),
  listGroups: () => Promise.resolve({ groups, counts: { RUNNING: 0, UPCOMING: 0, FINISHED: 0, ARCHIVED: 0 } }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: () => Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 200 }),
}));

const tt = arMessages.groups.board.timetable;
const SATURDAY = weekStartOf(todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone));

function lesson(id: string, groupId: string, name: string, time: string, over: Partial<BoardLesson> = {}, room: string | null = null): BoardLesson {
  return {
    id,
    group_id: groupId,
    teacher_id: "t1",
    teacher_name: "Miss Mona",
    slot_id: "s1",
    occurrence_local_date: SATURDAY,
    scheduled_at_utc: `${SATURDAY}T${time}:00Z`,
    duration_minutes: 60,
    status: "SCHEDULED",
    cancel_reason: null,
    moved: false,
    extra: false,
    topic: null,
    homework: null,
    notes: null,
    outcome_set_at: null,
    counts: { present: 0, late: 0, absent: 0, excused: 0, marked: 0, expected: 4 },
    group: { id: groupId, name, level: null, timezone: "UTC", mode: "OFFLINE", location: room, specialization_name: "English" },
    slot: { weekday: 6, start_time_local: time, duration_minutes: 60 },
    ...over,
  };
}

const centre = () =>
  makeSession("ACADEMY_OWNER", { permissions: ["group.read", "group.manage", "session.mark_attendance"], capabilities: ["groups", "centre"] });

describe("timetable helpers", () => {
  it("opens the week on Saturday", () => {
    expect(weekStartOf("2026-10-29")).toBe("2026-10-24"); // Thursday → Saturday before
    expect(weekStartOf("2026-10-24")).toBe("2026-10-24");
    expect(weekStartOf("2026-10-30")).toBe("2026-10-24"); // Friday closes the week
  });

  it("flags two groups in one room at once, whatever the spelling, and frees a cancelled lesson's room", () => {
    const rows = [
      lesson("a", "g1", "Grade 5 Math", "16:00", {}, "Room 3"),
      lesson("b", "g2", "Prep 1 Science", "16:15", { duration_minutes: 45 }, " room 3 "),
      lesson("c", "g3", "KG2 English", "16:00", {}, "Room 4"),
      lesson("d", "g4", "Prep 2 Arabic", "17:00", {}, "Room 3"), // starts as "a" and "b" end
      lesson("e", "g5", "Grade 6 French", "16:00", { status: "CANCELLED" }, "Room 4"),
    ].map(toTimetableRow);

    expect([...roomClashes(rows)].sort()).toEqual(["a", "b"]);
  });
});

describe("TimetableBoard — the centre's week by the hour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groups = [];
    listBoardLessons.mockImplementation(async (p: { view: string }) => ({
      view: p.view,
      from: SATURDAY,
      to: SATURDAY,
      timezone: "UTC",
      lessons:
        p.view === "week"
          ? [
              lesson("a", "g1", "Grade 5 Math", "16:00", {}, "Room 3"),
              lesson("b", "g2", "Prep 1 Science", "16:30", {}, "Room 3"),
              lesson("c", "g3", "KG2 English", "17:00", {}, "Room 4"),
            ]
          : [],
    }));
  });

  it("opens a centre on the timetable: one block per hour, room clashes red, filter by hour", async () => {
    const user = userEvent.setup();
    render(withAuth(centre(), <LessonsBoard />));

    await user.click(await screen.findByTestId("timetable-day-all"));
    const four = await screen.findByTestId(`timetable-hour-${SATURDAY}-16`);
    expect(within(four).getByTestId("timetable-row-a")).toBeInTheDocument();
    expect(within(four).getByTestId("timetable-row-b")).toBeInTheDocument();
    expect(within(four).getByTestId("timetable-clash-a")).toHaveTextContent(tt.clash);
    expect(screen.getByTestId(`timetable-hour-${SATURDAY}-17`)).toBeInTheDocument();
    expect(screen.queryByTestId("timetable-clash-c")).toBeNull();

    await user.selectOptions(screen.getByTestId("timetable-filter-hour"), "17");
    expect(screen.queryByTestId(`timetable-hour-${SATURDAY}-16`)).toBeNull();
    expect(screen.getByTestId("timetable-row-c")).toBeInTheDocument();
  });

  it("is not there for an academy that is not a centre", async () => {
    render(
      withAuth(makeSession("ACADEMY_OWNER", { permissions: ["group.read"], capabilities: ["groups"] }), <LessonsBoard />),
    );

    await waitFor(() => expect(screen.getByTestId("lessons-view-day")).toBeInTheDocument());
    expect(screen.queryByTestId("lessons-view-timetable")).toBeNull();
    expect(screen.queryByTestId("timetable")).toBeNull();
  });

  it("moves a group's weekly time for good: its slot is rewritten, the other slots kept", async () => {
    groups = [
      {
        id: "g3",
        name: "KG2 English",
        status: "ACTIVE",
        slots: [
          { weekday: 1, start_time_local: "17:00", duration_minutes: 60 },
          { weekday: 6, start_time_local: "17:00", duration_minutes: 60 },
        ],
      } as GroupRow,
    ];
    updateGroup.mockResolvedValue({ group: {}, generated: { created: 1, removed: 1 } });
    const user = userEvent.setup();
    render(withAuth(centre(), <LessonsBoard />));

    await user.click(await screen.findByTestId("timetable-day-all"));
    await user.click(await screen.findByTestId("timetable-menu-c"));
    await user.click(await screen.findByText(tt.move));
    await user.click(await screen.findByTestId("timetable-scope-weekly"));
    const time = screen.getByTestId("timetable-move-time");
    await user.clear(time);
    await user.type(time, "18:00");
    await user.click(screen.getByTestId("timetable-move-save"));

    await waitFor(() =>
      expect(updateGroup).toHaveBeenCalledWith("g3", {
        slots: [
          { weekday: 1, start_time_local: "17:00", duration_minutes: 60 },
          { weekday: 6, start_time_local: "18:00", duration_minutes: 60 },
        ],
      }),
    );
    expect(rescheduleGroupLesson).not.toHaveBeenCalled();
  });
});
