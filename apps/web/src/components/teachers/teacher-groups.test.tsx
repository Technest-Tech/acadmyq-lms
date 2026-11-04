import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardLesson, GroupRow } from "@/lib/groups-api";
import enMessages from "../../../messages/en.json";
import { TeacherGroups, weekStartOf } from "./teacher-groups";

vi.mock("@/lib/groups-api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/groups-api")>()),
  listGroups: vi.fn(),
  listBoardLessons: vi.fn(),
}));

import * as groupsApi from "@/lib/groups-api";

function group(overrides: Partial<GroupRow>): GroupRow {
  return {
    id: "g1",
    name: "English A1",
    specialization_id: null,
    specialization_name: "English",
    level: "A1",
    teacher_id: "t1",
    teacher_name: "Mona",
    capacity: 10,
    member_count: 7,
    mode: "OFFLINE",
    location: "Room 2",
    meeting_url: null,
    timezone: "Africa/Cairo",
    start_date: "2026-06-01",
    end_date: null,
    status: "ACTIVE",
    state: "RUNNING",
    slots: [],
    lessons: { held: 4, cancelled: 0, upcoming: 8, overdue: 2, next_lesson_at: "2026-06-22T15:00:00Z" },
    pricing: null,
    teacher_pay: null,
    ...overrides,
  };
}

function owedLesson(overrides: Partial<BoardLesson>): BoardLesson {
  return {
    id: "l1",
    group_id: "g1",
    teacher_id: "t1",
    teacher_name: "Mona",
    slot_id: "s1",
    occurrence_local_date: "2026-06-15",
    scheduled_at_utc: "2026-06-15T15:00:00Z",
    duration_minutes: 60,
    status: "SCHEDULED",
    cancel_reason: null,
    moved: false,
    extra: false,
    topic: null,
    homework: null,
    notes: null,
    outcome_set_at: null,
    counts: null,
    group: { id: "g1", name: "English A1", level: "A1", timezone: "Africa/Cairo", mode: "OFFLINE", location: "Room 2" },
    ...overrides,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TeacherGroups teacherId="t1" />
    </NextIntlClientProvider>,
  );
}

describe("TeacherGroups (the teacher's Groups tab)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes the week from Saturday", () => {
    expect(weekStartOf(new Date(2026, 5, 17))).toBe("2026-06-13"); // Wednesday 17 June → Saturday 13 June
    expect(weekStartOf(new Date(2026, 5, 13))).toBe("2026-06-13");
    expect(weekStartOf(new Date(2026, 5, 12))).toBe("2026-06-06"); // Friday → the Saturday before
  });

  it("lists the teacher's active groups with level, seats, next lesson and the sheets owed this week", async () => {
    const thisWeek = weekStartOf(new Date());
    vi.mocked(groupsApi.listGroups).mockResolvedValue({
      groups: [group({}), group({ id: "g2", name: "Maths 3", level: null, capacity: null, member_count: 12, lessons: { held: 0, cancelled: 0, upcoming: 0, overdue: 0, next_lesson_at: null } })],
      counts: { UPCOMING: 0, RUNNING: 2, FINISHED: 0, ARCHIVED: 0 },
    });
    vi.mocked(groupsApi.listBoardLessons).mockResolvedValue({
      view: "owed",
      from: "",
      to: "",
      timezone: "Africa/Cairo",
      lessons: [
        owedLesson({ id: "l1", occurrence_local_date: thisWeek }),
        // Owed too, but from an earlier week: not this week's count.
        owedLesson({ id: "l0", occurrence_local_date: "2026-01-05" }),
      ],
    });
    renderTab();

    const cards = await screen.findAllByTestId("teacher-group");
    expect(cards).toHaveLength(2);
    expect(groupsApi.listGroups).toHaveBeenCalledWith({ teacher_id: "t1", state: "ACTIVE" });
    expect(groupsApi.listBoardLessons).toHaveBeenCalledWith({ view: "owed", teacher_id: "t1" });

    const first = cards[0]!;
    expect(within(first).getByRole("link")).toHaveAttribute("href", "/groups/g1");
    expect(first).toHaveTextContent("A1");
    expect(first).toHaveTextContent("7 / 10");
    expect(first).toHaveTextContent("Next:");
    expect(within(first).getByTestId("teacher-group-owed")).toHaveTextContent("1 sheet owed this week");

    const second = cards[1]!;
    expect(second).toHaveTextContent("No level set");
    expect(second).toHaveTextContent("12 students");
    expect(second).toHaveTextContent("No upcoming lesson");
    expect(within(second).getByTestId("teacher-group-owed")).toHaveTextContent("No sheets owed this week");
  });

  it("says so when the teacher has no group", async () => {
    vi.mocked(groupsApi.listGroups).mockResolvedValue({ groups: [], counts: { UPCOMING: 0, RUNNING: 0, FINISHED: 0, ARCHIVED: 0 } });
    vi.mocked(groupsApi.listBoardLessons).mockResolvedValue({ view: "owed", from: "", to: "", timezone: "Africa/Cairo", lessons: [] });
    renderTab();

    expect(await screen.findByTestId("teacher-groups-empty")).toBeInTheDocument();
  });
});
