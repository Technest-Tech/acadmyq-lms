import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import type { CalendarSession } from "@/lib/api";
import { TimetableLogModal } from "./timetable-log-modal";

/**
 * EnglishSpirit, 2026-11-10: a block of 16 lessons, a timetable running on past its end, and the
 * log said 22. A package student's log now opens on the package's own lessons — the 7 counted on it
 * and the 9 its balance still covers — with "all lessons" one tab away.
 */

const getCalendar = vi.fn();
const listLessonPackages = vi.fn();
const getLessonPackage = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getCalendar: (q: unknown) => getCalendar(q),
  listLessonPackages: (q: unknown) => listLessonPackages(q),
  getLessonPackage: (id: string) => getLessonPackage(id),
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
  getLessonPackage.mockResolvedValue({ package: {}, credits: sessions.slice(0, 7).map((s, i) => ({ id: `c${i}`, session_id: s.id })) });
});

const open = () =>
  render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["package.read", "session.read"] }), <TimetableLogModal studentId="st1" studentName="Doaa walid" tz="Africa/Cairo" canAct onClose={() => {}} onSelectSession={() => {}} />));

describe("TimetableLogModal for a package student", () => {
  it("opens on the package's 16 lessons, and shows all 22 on the other tab", async () => {
    open();
    const tabs = await screen.findByTestId("log-view");
    expect(within(tabs).getByTestId("log-view-package")).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByTestId("log-view-package").textContent).toMatch(/16|١٦/);
    expect(within(tabs).getByTestId("log-view-all").textContent).toMatch(/22|٢٢/);
    expect(screen.getByText(/^(16|١٦) حصة$/)).toBeInTheDocument();

    await userEvent.click(within(tabs).getByTestId("log-view-all"));
    expect(screen.getByText(/^(22|٢٢) حصة$/)).toBeInTheDocument();
  });

  it("keeps the whole log, with no tabs, for a student without an open package", async () => {
    listLessonPackages.mockResolvedValue({ packages: [] });
    open();
    expect(await screen.findByText(/^(22|٢٢) حصة$/)).toBeInTheDocument();
    expect(screen.queryByTestId("log-view")).toBeNull();
  });
});
