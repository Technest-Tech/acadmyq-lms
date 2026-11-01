import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { StudentRow } from "@/lib/api";
import { AddTimetableModal } from "./add-timetable-modal";

const student = (over: Partial<StudentRow>): StudentRow =>
  ({ id: "s1", full_name: "محمد أحمد", whatsapp_phone: null, guardian_phone: null, teacher_name: "Miss Mona", teacher_id: null, ...over }) as StudentRow;

async function pickStudent(row: StudentRow) {
  render(
    withAuth(
      makeSession("ACADEMY_OWNER"),
      <AddTimetableModal students={[row]} teachers={[]} defaultTimezone="Africa/Cairo" onClose={() => {}} onCreated={() => {}} />,
    ),
  );
  await userEvent.click(screen.getByText(arMessages.scheduling.timetables.selectStudent));
  await userEvent.click(screen.getByText(/محمد أحمد/));
}

const durationInput = () => screen.getByLabelText(arMessages.scheduling.duration);

/**
 * A timetable starts at a flat 30 minutes. Sixteen Ana Muslim students priced at 40 got exactly that,
 * and every one of their lessons was then billed and paid at 30.
 */
describe("new timetable lesson length", () => {
  it("starts at the length the student is priced at", async () => {
    await pickStudent(student({ lesson_minutes: 40 }));

    expect(durationInput()).toHaveValue(40);
    expect(screen.queryByTestId("lesson-length-warning")).not.toBeInTheDocument();
  });

  it("warns when the length is changed away from the price", async () => {
    await pickStudent(student({ lesson_minutes: 40 }));

    fireEvent.change(durationInput(), { target: { value: "30" } });

    expect(screen.getByTestId("lesson-length-warning")).toBeInTheDocument();
  });

  it("keeps the default for a student whose price names no length", async () => {
    await pickStudent(student({ lesson_minutes: null }));

    expect(durationInput()).toHaveValue(30);
    expect(screen.queryByTestId("lesson-length-warning")).not.toBeInTheDocument();
  });
});
