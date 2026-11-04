import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { GroupDetailScreen } from "./group-detail";

const ar = messages.groups;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/groups/g1",
  useSearchParams: () => new URLSearchParams(),
}));

const getGroup = vi.fn();
const listGroupLessons = vi.fn();
vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  getGroup: (...args: unknown[]) => getGroup(...args),
  listGroupLessons: (...args: unknown[]) => listGroupLessons(...args),
  getGroupWaitlist: vi.fn(async () => ({ entries: [], waiting_count: 0, member_count: 7, capacity: 8, free_seats: 1 })),
}));

const HOUR = 3_600_000;
const lesson = (id: string, offsetHours: number, over: Record<string, unknown> = {}) => ({
  id,
  group_id: "g1",
  teacher_id: "t1",
  teacher_name: "Ali",
  slot_id: "s1",
  occurrence_local_date: "2026-11-01",
  scheduled_at_utc: new Date(Date.now() + offsetHours * HOUR).toISOString(),
  duration_minutes: 90,
  status: "SCHEDULED",
  cancel_reason: null,
  moved: false,
  extra: false,
  topic: null,
  homework: null,
  notes: null,
  outcome_set_at: null,
  counts: { present: 0, late: 0, absent: 0, excused: 0, marked: 0, expected: 7 },
  ...over,
});

const group = {
  id: "g1",
  name: "IELTS",
  level: "B2",
  specialization_id: null,
  specialization_name: null,
  teacher_id: "t1",
  teacher_name: "Ali",
  capacity: 8,
  member_count: 7,
  mode: "OFFLINE",
  location: "Room 2",
  meeting_url: null,
  effective_meeting_url: null,
  timezone: "Africa/Cairo",
  start_date: "2026-09-07",
  end_date: null,
  status: "ACTIVE",
  state: "RUNNING",
  attendance_rate: 0.93,
  lessons_planned: 24,
  lessons_held: 10,
  slots: [{ weekday: 1, start_time_local: "17:00", duration_minutes: 90 }],
  lessons: { held: 10, cancelled: 0, upcoming: 17, overdue: 1, next_lesson_at: null },
  pricing: null,
  teacher_pay: null,
  notes: null,
  members: [
    { id: "m1", student_id: "s1", full_name: "Adam Carter", status: "ACTIVE", joined_on: "2026-09-07", left_on: null, guardian_name: null, left_reason: null, price_minor: null, attendance: { rate: 0.5, absent: 5 } },
  ],
};

const centreSession = () =>
  makeSession("ACADEMY_OWNER", {
    academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" },
    capabilities: ["groups", "centre"],
    permissions: ["group.read", "group.manage", "session.mark_attendance"],
  });

beforeEach(() => {
  vi.clearAllMocks();
  getGroup.mockResolvedValue({ group });
  listGroupLessons.mockResolvedValue({
    lessons: [lesson("owed", -30), lesson("next", 30), lesson("done", -60, { status: "HELD", counts: { present: 5, late: 1, absent: 1, excused: 0, marked: 7, expected: 7 } })],
  });
});

describe("GroupDetailScreen — a learning centre's look", () => {
  it("opens on the group's band and its four numbers, in reading order", async () => {
    render(withAuth(centreSession(), <GroupDetailScreen groupId="g1" />));

    const hero = within(await screen.findByTestId("group-hero"));
    expect(hero.getByRole("heading", { name: "IELTS" })).toBeInTheDocument();
    expect(hero.getByText("Room 2")).toBeInTheDocument();
    expect(hero.getByTestId("group-edit")).toBeInTheDocument();

    const stats = within(screen.getByTestId("group-stats"));
    expect(stats.getByText("93%")).toBeInTheDocument();
    expect(stats.getByText("7 / 8")).toHaveAttribute("dir", "ltr");
    expect(stats.getByTestId("group-progress")).toHaveTextContent("10 / 24");
    expect(stats.getByText(ar.card.overdue)).toBeInTheDocument();
  });

  it("keeps every lesson's actions, grouped into cards with a date tile", async () => {
    render(withAuth(centreSession(), <GroupDetailScreen groupId="g1" />));

    expect(await screen.findByTestId("lessons-owed")).toHaveTextContent(ar.lessons.takeAttendance);
    expect(screen.getByTestId("lesson-mark-next")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: new RegExp(ar.lessons.past) })).toBeInTheDocument();
    // Six of seven came, and the one who did not is its own red badge.
    const held = within(screen.getByTestId("lesson-done"));
    expect(held.getByText("6 / 7")).toHaveAttribute("dir", "ltr");
    expect(held.getByText("−1")).toBeInTheDocument();
  });

  it("switches tabs: the students as a list with faces and attendance, the overview without repeating the numbers", async () => {
    const user = userEvent.setup();
    render(withAuth(centreSession(), <GroupDetailScreen groupId="g1" />));

    await user.click(await screen.findByTestId("group-tab-members"));
    const row = within(await screen.findByTestId("member-s1"));
    expect(row.getByText("AC")).toBeInTheDocument();
    expect(row.getByText("50%")).toBeInTheDocument();
    expect(screen.getByTestId("members-add")).toBeInTheDocument();

    await user.click(screen.getByTestId("group-tab-overview"));
    const overview = within(await screen.findByTestId("group-overview"));
    expect(overview.queryByText(ar.overview.attendance)).toBeNull();
    expect(overview.getByText(ar.form.teacher)).toBeInTheDocument();
  });
});

describe("GroupDetailScreen — every other academy", () => {
  it("keeps the band, the underlined tabs and the overview's own numbers", async () => {
    const user = userEvent.setup();
    render(withAuth(makeSession("ACADEMY_OWNER", { capabilities: ["groups"], permissions: ["group.read", "group.manage"] }), <GroupDetailScreen groupId="g1" />));

    expect(await screen.findByRole("heading", { name: "IELTS" })).toBeInTheDocument();
    expect(screen.queryByTestId("group-hero")).toBeNull();
    expect(screen.queryByTestId("group-stats")).toBeNull();

    await user.click(screen.getByTestId("group-tab-overview"));
    expect(within(await screen.findByTestId("group-overview")).getByText(ar.overview.attendance)).toBeInTheDocument();
  });
});
