import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import type { CalendarSession } from "@/lib/api";
import { TimetableLogModal } from "./timetable-log-modal";

/**
 * EnglishSpirit, 2026-11-10: a block of 16 lessons, a timetable running on past its end, and the
 * log said 22. The log now leaves out the upcoming lessons past the open package's end — every
 * academy, no setting — so it shows the 7 counted and the 9 the balance still covers.
 */

const getCalendar = vi.fn();
const listLessonPackages = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getCalendar: (q: unknown) => getCalendar(q),
  listLessonPackages: (q: unknown) => listLessonPackages(q),
}));

const DAY = 86_400_000;
const lesson = (i: number, offsetDays: number, status: CalendarSession["status"]): CalendarSession => ({
  id: `s${i}`,
  student_id: "st1",
  teacher_id: "t1",
  schedule_id: "sch1",
  scheduled_at_utc: new Date(Date.now() + offsetDays * DAY).toISOString(),
  duration_minutes: 60,
  status,
  status_reason: null,
  original_session_id: null,
  student_name: "Doaa walid",
  teacher_name: "Ms Sara",
});

// 7 past lessons on the block, then 15 upcoming of which the block covers 9.
const sessions = [
  ...Array.from({ length: 7 }, (_, i) => lesson(i, -30 + i * 3, "ATTENDED")),
  ...Array.from({ length: 15 }, (_, i) => lesson(7 + i, 1 + i * 3, "SCHEDULED")),
];

beforeEach(() => {
  vi.clearAllMocks();
  getCalendar.mockResolvedValue({ sessions });
  listLessonPackages.mockResolvedValue({
    packages: [{ id: "p1", status: "ACTIVE", subject: null, upcoming_lesson_count: 15, upcoming_in_package_count: 9 }],
  });
});

const open = () =>
  render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["package.read", "session.read"] }), <TimetableLogModal studentId="st1" studentName="Doaa walid" tz="Africa/Cairo" canAct onClose={() => {}} onSelectSession={() => {}} />));

describe("TimetableLogModal for a package student", () => {
  it("shows the package's 16 lessons and none of the 6 past its end", async () => {
    open();
    expect(await screen.findByText(/^(16|١٦) حصة$/)).toBeInTheDocument();
    expect(screen.queryByTestId("log-view")).toBeNull();
  });

  it("keeps the whole log for a student without an open package", async () => {
    listLessonPackages.mockResolvedValue({ packages: [] });
    open();
    expect(await screen.findByText(/^(22|٢٢) حصة$/)).toBeInTheDocument();
  });
});
