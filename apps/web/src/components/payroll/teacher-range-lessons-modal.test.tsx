import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import ar from "../../../messages/ar.json";
import { formatMoney } from "@/lib/money";
import { makeSession, withAuth } from "@/test/auth";
import { TeacherRangeLessonsModal } from "./teacher-range-lessons-modal";

const getPayrollRangeLessons = vi.fn();
const attendPayrollLesson = vi.fn();
const getPayrollLessonRemovalPreview = vi.fn();
const removePayrollLesson = vi.fn();

/** The default test owner has no `payout.adjust`; the corrections are gated on it. */
const adjuster = () => {
  const session = makeSession("ACADEMY_OWNER");
  return { ...session, permissions: [...session.permissions, "payout.adjust"] };
};

const TARGET = { teacherId: "t1", teacherName: "محمد عرب", currency: "EGP" };

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPayrollRangeLessons: (...args: unknown[]) => getPayrollRangeLessons(...args),
  attendPayrollLesson: (...args: unknown[]) => attendPayrollLesson(...args),
  getPayrollLessonRemovalPreview: (...args: unknown[]) => getPayrollLessonRemovalPreview(...args),
  removePayrollLesson: (...args: unknown[]) => removePayrollLesson(...args),
}));

function lesson(id: string, student: string, date: string, amount: number) {
  return {
    id,
    payout_id: "p1",
    session_id: `s-${id}`,
    session_date: date,
    student_id: "st1",
    student_name: student,
    duration_minutes: 60,
    scheduled_at_utc: `${date}T10:00:00Z`,
    amount_minor: amount,
    currency: "EGP",
    finalized: false,
    removed: false,
  };
}

beforeEach(() => {
  getPayrollRangeLessons.mockReset();
  attendPayrollLesson.mockReset();
  getPayrollLessonRemovalPreview.mockReset();
  removePayrollLesson.mockReset();
});

it("lists the teacher's lessons in the window and totals them", async () => {
  getPayrollRangeLessons.mockResolvedValue({
    lessons: [
      lesson("1", "Omar", "2026-10-02", 12000),
      lesson("2", "Laila", "2026-10-04", 12000),
    ],
    not_on_salary: [],
  });

  render(
    withAuth(
      makeSession("ACADEMY_OWNER"),
      <TeacherRangeLessonsModal
        target={{ teacherId: "t1", teacherName: "محمد عرب", currency: "EGP" }}
        from="2026-10-01"
        to="2026-10-31"
        onClose={vi.fn()}
      />,
    ),
  );

  const list = await screen.findByTestId("range-lessons");
  expect(within(list).getByText("Omar")).toBeInTheDocument();
  expect(within(list).getByText("Laila")).toBeInTheDocument();
  expect(getPayrollRangeLessons).toHaveBeenCalledWith("t1", "2026-10-01", "2026-10-31", "EGP");
  // Same window, same teacher, same currency as the figure that was tapped.
  expect(screen.getByRole("dialog")).toHaveTextContent(
    formatMoney({ amount: 24000, currency: "EGP" }, "ar").replace(/\s+/g, " "),
  );
});

it("offers corrections to whoever can adjust pay, and only on lessons they can reach", async () => {
  getPayrollRangeLessons.mockResolvedValue({
    lessons: [
      lesson("1", "Omar", "2026-10-02", 12000),
      { ...lesson("2", "Laila", "2026-09-04", 12000), finalized: true, removed: true },
      { ...lesson("3", "", "2026-10-05", 5000), session_id: null, student_name: null, group_name: "Group A" },
    ],
    not_on_salary: [
      { id: "s9", status: "SCHEDULED", duration_minutes: 60, student_name: "Sara", session_date: "2026-10-06", local_time: "13:00" },
    ],
  });
  attendPayrollLesson.mockResolvedValue({ session_id: "s9", statement_year: 2026, statement_month: 11, carried: true });
  const onMutated = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();

  render(
    withAuth(
      adjuster(),
      <TeacherRangeLessonsModal
        target={TARGET}
        from="2026-10-01"
        to="2026-10-31"
        onClose={onClose}
        onMutated={onMutated}
      />,
    ),
  );

  await screen.findByTestId("range-lessons");
  expect(screen.getByTestId("lesson-edit-1")).toBeInTheDocument();
  // A lesson already taken off a sealed statement, and a group line, have nothing to correct here.
  expect(screen.queryByTestId("lesson-edit-2")).not.toBeInTheDocument();
  expect(screen.getByTestId("lesson-removed-2")).toBeInTheDocument();
  expect(screen.queryByTestId("lesson-remove-3")).not.toBeInTheDocument();

  await user.click(screen.getByTestId("lesson-count-s9"));
  expect(attendPayrollLesson).toHaveBeenCalledWith("s9");
  expect(await screen.findByRole("dialog")).toHaveTextContent("11/2026");
  expect(getPayrollRangeLessons).toHaveBeenCalledTimes(2);

  // The page behind only refreshes when the popup closes.
  expect(onMutated).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(onMutated).toHaveBeenCalledTimes(1);
});

it("shows the server's calculation before a removal, and removes on confirm", async () => {
  getPayrollRangeLessons.mockResolvedValue({ lessons: [lesson("1", "Omar", "2026-10-02", 12000)], not_on_salary: [] });
  getPayrollLessonRemovalPreview.mockResolvedValue({ amount_minor: 12000, currency: "EGP", payout_sealed: true, student_locked: true });
  removePayrollLesson.mockResolvedValue({});
  const user = userEvent.setup();

  render(
    withAuth(
      adjuster(),
      <TeacherRangeLessonsModal target={TARGET} from="2026-10-01" to="2026-10-31" onClose={vi.fn()} />,
    ),
  );

  await user.click(await screen.findByTestId("lesson-remove-1"));
  const effect = await screen.findByTestId("lesson-remove-effect");
  expect(effect).toHaveTextContent(ar.payroll.lessonBillLocked);

  await user.click(screen.getByTestId("lesson-remove-confirm"));
  expect(removePayrollLesson).toHaveBeenCalledWith("s-1");
  expect(screen.queryByTestId("lesson-remove-effect")).not.toBeInTheDocument();
});

it("is read-only without payout.adjust", async () => {
  getPayrollRangeLessons.mockResolvedValue({
    lessons: [lesson("1", "Omar", "2026-10-02", 12000)],
    not_on_salary: [
      { id: "s9", status: "SCHEDULED", duration_minutes: 60, student_name: "Sara", session_date: "2026-10-06", local_time: "13:00" },
    ],
  });

  render(
    withAuth(
      makeSession("ACADEMY_OWNER"),
      <TeacherRangeLessonsModal target={TARGET} from="2026-10-01" to="2026-10-31" onClose={vi.fn()} />,
    ),
  );

  await screen.findByTestId("range-lessons");
  expect(screen.queryByTestId("lesson-edit-1")).not.toBeInTheDocument();
  expect(screen.queryByTestId("lesson-add")).not.toBeInTheDocument();
  expect(screen.queryByTestId("not-on-salary")).not.toBeInTheDocument();
});
