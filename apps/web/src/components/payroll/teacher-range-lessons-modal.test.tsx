import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { formatMoney } from "@/lib/money";
import { makeSession, withAuth } from "@/test/auth";
import { TeacherRangeLessonsModal } from "./teacher-range-lessons-modal";

const getPayrollRangeLessons = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPayrollRangeLessons: (...args: unknown[]) => getPayrollRangeLessons(...args),
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
  };
}

beforeEach(() => getPayrollRangeLessons.mockReset());

it("lists the teacher's lessons in the window and totals them", async () => {
  getPayrollRangeLessons.mockResolvedValue({
    lessons: [
      lesson("1", "Omar", "2026-10-02", 12000),
      lesson("2", "Laila", "2026-10-04", 12000),
    ],
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
