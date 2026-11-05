import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { StudentTimetable } from "./student-timetable";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getCalendar: vi.fn(),
  deleteSession: vi.fn(),
}));
// The weekly timetable editors above the list have their own tests and their own requests.
vi.mock("@/components/scheduling/schedule-editor", () => ({ TeacherTimetables: () => null }));

import * as api from "@/lib/api";

const lesson = (over: Partial<api.CalendarSession>): api.CalendarSession => ({
  id: "x",
  student_id: "s1",
  teacher_id: "t1",
  schedule_id: null,
  scheduled_at_utc: new Date().toISOString(),
  duration_minutes: 30,
  status: "SCHEDULED",
  status_reason: null,
  original_session_id: null,
  student_name: "Rand",
  teacher_name: "Abeer",
  ...over,
});

const OWNER_CAPS = ["session.read", "schedule.read", "session.delete"];

function renderTab(permissions = OWNER_CAPS, profile?: "CENTRE") {
  const session = makeSession("ACADEMY_OWNER", { permissions });
  if (profile && session.academy) session.academy = { ...session.academy, profile };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(session)}>
        <StudentTimetable studentId="s1" studentName="Rand" teachers={[]} canManage={false} onError={() => {}} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("StudentTimetable lesson delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCalendar).mockResolvedValue({
      sessions: [lesson({ id: "a" }), lesson({ id: "b", status: "ATTENDED" })],
    } as Awaited<ReturnType<typeof api.getCalendar>>);
    vi.mocked(api.deleteSession).mockResolvedValue({ ok: true });
  });

  it("puts a delete button on every lesson, and deletes the one confirmed", async () => {
    const user = userEvent.setup();
    renderTab();

    await screen.findByTestId("session-delete-a");
    expect(screen.getByTestId("session-delete-b")).toBeInTheDocument();

    await user.click(screen.getByTestId("session-delete-b"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/comes off the student's invoice/)).toBeInTheDocument();
    await user.click(screen.getByTestId("lesson-delete-confirm"));

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith("b"));
    await waitFor(() => expect(api.getCalendar).toHaveBeenCalledTimes(2));
  });

  it("offers no delete without the right, or at a centre", async () => {
    renderTab(["session.read", "schedule.read"]);
    await screen.findByTestId("session-a");
    expect(screen.queryByTestId("session-delete-a")).toBeNull();
  });

  it("offers no delete at a learning centre", async () => {
    renderTab(OWNER_CAPS, "CENTRE");
    await screen.findByTestId("session-a");
    expect(screen.queryByTestId("session-delete-a")).toBeNull();
  });
});
