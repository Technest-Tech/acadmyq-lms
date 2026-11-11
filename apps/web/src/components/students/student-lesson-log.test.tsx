import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { StudentLessonLog } from "./student-lesson-log";

/**
 * The profile's lesson log (EnglishSpirit, 2026-11-11): the current package's lessons, numbered, no
 * more and no less — and the month for a student with no package.
 */
const listLessonPackages = vi.fn();
const getPackageLessons = vi.fn();
const getCalendar = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listLessonPackages: (...a: unknown[]) => listLessonPackages(...a),
  getPackageLessons: (...a: unknown[]) => getPackageLessons(...a),
  getCalendar: (...a: unknown[]) => getCalendar(...a),
}));

const ar = arMessages.students.lessonLog;
const owner = () => makeSession("ACADEMY_OWNER", { permissions: ["session.read", "package.read"] });

const pkg = (over: Record<string, unknown> = {}) => ({
  id: "p5", student_id: "s1", label: "16 × 60 د", sequence_no: 5, status: "ACTIVE", subject: null, ...over,
});

const lesson = (id: string, at: string, status: string, state: string | null) => ({
  id, student_id: "s1", teacher_id: "t1", schedule_id: "sc1", scheduled_at_utc: at, duration_minutes: 60,
  status, status_reason: null, original_session_id: null, student_name: "Adam", teacher_name: "Miss Mona",
  package_state: state,
});

const log = () => ({
  lessons: [
    lesson("a", "2026-06-02T10:00:00+00:00", "ATTENDED", "COUNTED"),
    lesson("b", "2026-06-04T10:00:00+00:00", "ABSENT_UNEXCUSED", "COUNTED"),
    lesson("c", "2026-06-09T10:00:00+00:00", "SCHEDULED", "UNMARKED"),
    lesson("d", "2099-06-12T10:00:00+00:00", "SCHEDULED", "UPCOMING"),
  ],
  not_counted: [lesson("x", "2026-06-05T10:00:00+00:00", "CANCELLED_BY_TEACHER", null)],
  unscheduled: 2,
  lessons_total: 6,
});

beforeEach(() => {
  listLessonPackages.mockReset();
  getPackageLessons.mockReset();
  getCalendar.mockReset();
});

describe("StudentLessonLog", () => {
  it("lists the running package's lessons in order, numbered, then the ones with no date yet", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg(), pkg({ id: "p4", sequence_no: 4, status: "COMPLETED" })] });
    getPackageLessons.mockResolvedValue(log());
    render(withAuth(owner(), <StudentLessonLog studentId="s1" />));

    const list = await screen.findByTestId("lesson-log-list");
    expect(getPackageLessons).toHaveBeenCalledWith("p5");

    const rows = within(list).getAllByTestId(/^lesson-log-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "lesson-log-row-a",
      "lesson-log-row-b",
      "lesson-log-row-c",
      "lesson-log-row-d",
    ]);
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual(["1", "2", "3", "4"]);

    // Each one says how it stands: what it ended as, waiting for a mark, or still to come.
    expect(within(rows[0]!).getByTestId("lesson-log-status")).toHaveTextContent(arMessages.scheduling.status.ATTENDED);
    expect(within(rows[2]!).getByTestId("lesson-log-status")).toHaveTextContent(ar.unmarked);
    expect(within(rows[3]!).getByTestId("lesson-log-status")).toHaveTextContent(ar.upcoming);

    // The two the balance pays for with no date take the next numbers: the block is all here.
    expect(screen.getByTestId("lesson-log-unscheduled")).toHaveTextContent("5–6");
    expect(screen.getByTestId("lesson-log-total")).toHaveTextContent("6");
  });

  it("keeps the lessons it never counted apart, folded", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    getPackageLessons.mockResolvedValue(log());
    render(withAuth(owner(), <StudentLessonLog studentId="s1" />));

    const toggle = await screen.findByTestId("lesson-log-not-counted-toggle");
    expect(screen.queryByTestId("lesson-log-row-x")).not.toBeInTheDocument();

    await userEvent.setup().click(toggle);
    expect(within(screen.getByTestId("lesson-log-not-counted")).getByTestId("lesson-log-row-x")).toBeInTheDocument();
  });

  it("opens an earlier package from the picker", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg(), pkg({ id: "p4", sequence_no: 4, status: "COMPLETED" })] });
    getPackageLessons.mockResolvedValue(log());
    render(withAuth(owner(), <StudentLessonLog studentId="s1" />));

    await screen.findByTestId("lesson-log-list");
    await userEvent.setup().selectOptions(screen.getByTestId("lesson-log-package"), "p4");

    await waitFor(() => expect(getPackageLessons).toHaveBeenLastCalledWith("p4"));
  });

  it("shows the month's lessons for a student with no package, trials and groups left out", async () => {
    listLessonPackages.mockResolvedValue({ packages: [] });
    getCalendar.mockResolvedValue({
      sessions: [
        lesson("m1", "2026-06-02T10:00:00+00:00", "ATTENDED", null),
        { ...lesson("tr", "2026-06-03T10:00:00+00:00", "SCHEDULED", null), trial: { id: "t" } },
        lesson("m2", "2026-06-09T10:00:00+00:00", "CANCELLED_BY_STUDENT", null),
      ],
    });
    render(withAuth(owner(), <StudentLessonLog studentId="s1" />));

    const list = await screen.findByTestId("lesson-log-list");
    expect(within(list).getAllByTestId(/^lesson-log-row-/).map((r) => r.getAttribute("data-testid"))).toEqual([
      "lesson-log-row-m1",
      "lesson-log-row-m2",
    ]);
    const query = getCalendar.mock.calls[0]?.[0] as { from: string; to: string; studentId: string };
    expect(query.studentId).toBe("s1");
    expect(query.from.endsWith("-01")).toBe(true);
    expect(getPackageLessons).not.toHaveBeenCalled();
  });

  it("goes straight to the month without the package permission", async () => {
    getCalendar.mockResolvedValue({ sessions: [] });
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["session.read"] }), <StudentLessonLog studentId="s1" />));

    expect(await screen.findByText(ar.monthEmpty)).toBeInTheDocument();
    expect(listLessonPackages).not.toHaveBeenCalled();
  });
});
