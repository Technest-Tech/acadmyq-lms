import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { TeacherLessons } from "./teacher-lessons";

// The Lessons tab on a teacher's profile: every lesson of the teacher for a month, with the
// attendance page's actions plus delete.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getSessionsByDay: vi.fn(),
  deleteSession: vi.fn(),
}));

import * as api from "@/lib/api";

const lesson = (over: Partial<api.DaySession>): api.DaySession => ({
  id: "x",
  student_id: "s1",
  teacher_id: "t1",
  scheduled_at_utc: "2020-01-05T10:00:00Z",
  duration_minutes: 60,
  status: "SCHEDULED",
  student_name: "Yusuf",
  teacher_name: "Kareem",
  student_status: "REGULAR",
  pending_cancel_type: null,
  ...over,
});

const ROWS = [
  lesson({ id: "done", status: "ATTENDED", student_name: "Maryam", done_by_name: "Sara" }),
  lesson({ id: "missed", student_name: "Omar" }),
  lesson({ id: "ahead", scheduled_at_utc: "2999-01-05T10:00:00Z", student_name: "Laila" }),
];

const OWNER_CAPS = [
  "teacher.read", "session.read", "session.mark_attendance", "session.reschedule",
  "session.revert_attendance", "session.delete",
];

function renderTab(permissions: string[] = OWNER_CAPS) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER", { permissions }))}>
        <TeacherLessons teacherId="t1" />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("TeacherLessons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: ROWS, truncated: false });
    vi.mocked(api.deleteSession).mockResolvedValue({ ok: true });
  });

  it("asks for this teacher's lessons only", async () => {
    renderTab();
    await screen.findByText("Maryam");
    expect(vi.mocked(api.getSessionsByDay).mock.calls[0]![0].teacher_id).toBe("t1");
  });

  it("shows recorded, unmarked and upcoming lessons, each with its actions", async () => {
    renderTab();
    const done = await screen.findByTestId("lesson-row-done");
    // A recorded lesson can be undone, but not moved.
    expect(within(done).getByTestId("lesson-undo")).toBeInTheDocument();
    expect(within(done).queryByTestId("lesson-reschedule")).toBeNull();
    expect(within(done).getByText("by Sara")).toBeInTheDocument();

    const missed = screen.getByTestId("lesson-row-missed");
    expect(within(missed).getByTestId("lesson-reschedule")).toBeInTheDocument();
    expect(within(missed).getByTestId("lesson-open")).toHaveTextContent("Mark");
    expect(within(missed).getByTestId("lesson-delete")).toBeInTheDocument();
  });

  it("filters to the upcoming lessons from the tile", async () => {
    renderTab();
    await screen.findByText("Maryam");
    await userEvent.click(screen.getByTestId("segment-upcoming"));
    expect(screen.getByText("Laila")).toBeInTheDocument();
    expect(screen.queryByText("Maryam")).toBeNull();
    expect(screen.queryByText("Omar")).toBeNull();
  });

  it("deletes a lesson after confirming, then reloads the month", async () => {
    renderTab();
    const done = await screen.findByTestId("lesson-row-done");
    await userEvent.click(within(done).getByTestId("lesson-delete"));

    // A recorded lesson warns that the money comes off the invoice and the salary.
    expect(screen.getByText(/off the teacher's salary/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("lesson-delete-confirm"));

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith("done"));
    await waitFor(() => expect(api.getSessionsByDay).toHaveBeenCalledTimes(2));
  });

  it("shows the server's refusal inside the dialog", async () => {
    vi.mocked(api.deleteSession).mockRejectedValue(new Error("This session's invoice is already closed"));
    renderTab();
    const done = await screen.findByTestId("lesson-row-done");
    await userEvent.click(within(done).getByTestId("lesson-delete"));
    await userEvent.click(screen.getByTestId("lesson-delete-confirm"));
    expect(await screen.findByTestId("lesson-delete-error")).toHaveTextContent("already closed");
  });

  it("hides delete from someone without the capability", async () => {
    renderTab(["teacher.read", "session.read", "session.mark_attendance"]);
    await screen.findByText("Maryam");
    expect(screen.queryByTestId("lesson-delete")).toBeNull();
    expect(screen.queryByTestId("lesson-undo")).toBeNull();
  });
});
