import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import type { Session } from "@/lib/api";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { AttendanceManager } from "./attendance-manager";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getSessionsByDay: vi.fn(),
  listTeachers: vi.fn(),
  getSession: vi.fn(),
  markAttendance: vi.fn(),
  putSessionReport: vi.fn(),
  markWhatsappSent: vi.fn(),
}));

import * as api from "@/lib/api";

const daySession = {
  id: "se1",
  student_id: "st1",
  teacher_id: "t1",
  scheduled_at_utc: "2026-06-01T15:00:00Z",
  duration_minutes: 30,
  status: "SCHEDULED" as const,
  student_name: "Abdullah",
  student_status: "TRIAL_BOOKED",
  teacher_name: "Ustadh",
  pending_cancel_type: null,
};

function ownerSession(): Session {
  return makeSession("ACADEMY_OWNER", {
    permissions: ["session.read", "session.mark_attendance", "session.write_report"],
  });
}

function renderManager(session: Session = ownerSession()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(session)}>
        <AttendanceManager />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("AttendanceManager (Sprint 6 premium worklist)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listTeachers).mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    vi.mocked(api.getSession).mockResolvedValue({
      session: {
        id: "se1",
        student_id: "st1",
        teacher_id: "t1",
        student_name: "Abdullah",
        teacher_name: "Ustadh",
        academy_name: "Test Academy",
        scheduled_at_utc: "2026-06-01T15:00:00Z",
        duration_minutes: 30,
        status: "SCHEDULED",
        status_reason: null,
        billed: false,
        outcome_set_at: null,
        classification: { billableToStudent: false, countsForTeacher: false },
        pending_cancellation: null,
        pending_free: null,
      },
      report: null,
      reportFields: [],
      inactiveReportFields: [],
    });
  });

  it("lists the day's sessions awaiting an outcome", async () => {
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [daySession] });
    renderManager();

    expect(await screen.findByTestId("day-list")).toBeInTheDocument();
    expect(screen.getByText("Abdullah")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches the day's filters", async () => {
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [] });
    renderManager();

    expect(await screen.findByTestId("day-empty")).toBeInTheDocument();
  });

  it("opens the attendance/report popup when a row is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [daySession] });
    renderManager();

    await user.click(await screen.findByText("Abdullah"));

    // The popup mounts the attendance/report surface and loads the session.
    expect(await screen.findByTestId("attendance-report")).toBeInTheDocument();
    expect(api.getSession).toHaveBeenCalledWith("se1");
  });
});
