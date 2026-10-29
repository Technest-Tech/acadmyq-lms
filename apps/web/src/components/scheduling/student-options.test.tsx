import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { StudentRow } from "@/lib/api";
import { AddTimetableModal } from "./add-timetable-modal";
import { studentOption } from "./student-options";

/**
 * Two students of the same name, told apart in the timetable pickers by their number (their own,
 * else their parent's) — and found by typing a few of its digits.
 */
const student = (over: Partial<StudentRow>): StudentRow =>
  ({ id: "s1", full_name: "محمد أحمد", whatsapp_phone: null, guardian_phone: null, teacher_name: "Miss Mona", teacher_id: "t1", teachers: [], ...over }) as unknown as StudentRow;

describe("student options", () => {
  it("puts the teacher and the student's number — else the parent's — beside the name", () => {
    expect(studentOption(student({ whatsapp_phone: "+201001112201", guardian_phone: "+201009998887" })).sublabel).toBe("Miss Mona · ⁦+201001112201⁩");
    expect(studentOption(student({ guardian_phone: "+201009998887" })).sublabel).toBe("Miss Mona · ⁦+201009998887⁩");
    expect(studentOption(student({ teacher_name: null })).sublabel).toBeUndefined();
  });

  it("tells two students of one name apart in the new-timetable picker, and finds one by its digits", async () => {
    const students = [student({ id: "s1", whatsapp_phone: "+201001112201" }), student({ id: "s2", guardian_phone: "+201005556677" })];
    render(withAuth(makeSession("ACADEMY_OWNER"), <AddTimetableModal students={students} teachers={[]} defaultTimezone="Africa/Cairo" onClose={() => {}} onCreated={() => {}} />));

    await userEvent.click(screen.getByText(arMessages.scheduling.timetables.selectStudent));
    expect(screen.getByText(/\+201001112201/)).toBeTruthy();
    expect(screen.getByText(/\+201005556677/)).toBeTruthy();

    await userEvent.type(screen.getByPlaceholderText(arMessages.scheduling.timetables.searchStudent), "5556");
    expect(screen.queryByText(/\+201001112201/)).toBeNull();
    expect(screen.getByText(/\+201005556677/)).toBeTruthy();
  });
});
