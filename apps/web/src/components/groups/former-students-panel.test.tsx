import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { GroupDetailScreen } from "./group-detail";

const ar = messages.groups.formerStudents;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/groups/g1",
  useSearchParams: () => new URLSearchParams(),
}));

const getGroup = vi.fn();
const getFormerStudents = vi.fn();
const makeFormerStudents = vi.fn();
vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  getGroup: (...args: unknown[]) => getGroup(...args),
  listGroupLessons: vi.fn(async () => ({ lessons: [] })),
  getFormerStudents: (...args: unknown[]) => getFormerStudents(...args),
  makeFormerStudents: (...args: unknown[]) => makeFormerStudents(...args),
}));

const group = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  name: "Tajweed course",
  level: null,
  specialization_id: null,
  specialization_name: null,
  teacher_id: "t1",
  teacher_name: "Sheikh Omar",
  capacity: null,
  member_count: 3,
  mode: "ONLINE",
  location: null,
  meeting_url: null,
  effective_meeting_url: null,
  timezone: "Africa/Cairo",
  start_date: "2026-09-01",
  end_date: "2026-11-01",
  status: "ARCHIVED",
  state: "ARCHIVED",
  attendance_rate: null,
  lessons_planned: null,
  lessons_held: 8,
  slots: [{ weekday: 6, start_time_local: "18:00", duration_minutes: 60 }],
  lessons: { held: 8, cancelled: 0, upcoming: 0, overdue: 0, next_lesson_at: null },
  pricing: null,
  teacher_pay: null,
  notes: null,
  members: [],
  ...over,
});

const rows = [
  { id: "s1", full_name: "آدم", outcome: "GRADUATE" },
  { id: "s2", full_name: "باسل", outcome: "PRIVATE" },
  { id: "s3", full_name: "سيلين", outcome: "OTHER_GROUP" },
  { id: "s4", full_name: "دينا", outcome: "ALREADY_FORMER" },
];

const session = (capabilities: string[], permissions = ["group.read", "group.manage", "student.deactivate"]) =>
  makeSession("ACADEMY_OWNER", { capabilities, permissions });

beforeEach(() => {
  vi.clearAllMocks();
  getGroup.mockResolvedValue({ group: group() });
  getFormerStudents.mockResolvedValue({ course_over: true, students: rows });
});

describe("FormerStudentsPanel (course_students)", () => {
  it("lists who moves and who stays, and moves them on confirm", async () => {
    makeFormerStudents.mockResolvedValue({ graduated: 1, kept: 3, students: rows.map((r) => (r.id === "s1" ? { ...r, outcome: "ALREADY_FORMER" } : r)) });
    const user = userEvent.setup();
    render(withAuth(session(["groups", "course_students"]), <GroupDetailScreen groupId="g1" />));

    const panel = await screen.findByTestId("former-students-panel");
    expect(panel).toHaveTextContent(ar.title);
    await user.click(within(panel).getByTestId("former-students-open"));

    expect(within(screen.getByTestId("former-students-moving")).getByText("آدم")).toBeInTheDocument();
    const staying = within(screen.getByTestId("former-students-staying"));
    expect(staying.getByText("باسل")).toBeInTheDocument();
    expect(staying.getByText(ar.reason.PRIVATE)).toBeInTheDocument();
    expect(staying.getByText(ar.reason.OTHER_GROUP)).toBeInTheDocument();
    // Already gone is nothing to decide: not listed.
    expect(screen.queryByText("دينا")).toBeNull();

    await user.click(screen.getByTestId("former-students-apply"));
    await waitFor(() => expect(makeFormerStudents).toHaveBeenCalledWith("g1"));
    // Nobody left to move: the panel goes.
    await waitFor(() => expect(screen.queryByTestId("former-students-panel")).toBeNull());
  });

  it("is not there without the switch, on a running course, or for a role that cannot deactivate", async () => {
    const { unmount } = render(withAuth(session(["groups"]), <GroupDetailScreen groupId="g1" />));
    await screen.findByRole("heading", { name: "Tajweed course" });
    expect(screen.queryByTestId("former-students-panel")).toBeNull();
    unmount();

    getGroup.mockResolvedValue({ group: group({ status: "ACTIVE", state: "RUNNING", end_date: null }) });
    const second = render(withAuth(session(["groups", "course_students"]), <GroupDetailScreen groupId="g1" />));
    await screen.findByRole("heading", { name: "Tajweed course" });
    expect(screen.queryByTestId("former-students-panel")).toBeNull();
    second.unmount();

    getGroup.mockResolvedValue({ group: group() });
    render(withAuth(session(["groups", "course_students"], ["group.read", "group.manage"]), <GroupDetailScreen groupId="g1" />));
    await screen.findByRole("heading", { name: "Tajweed course" });
    expect(screen.queryByTestId("former-students-panel")).toBeNull();
    expect(getFormerStudents).not.toHaveBeenCalled();
  });
});
