import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  rescheduleSession: vi.fn(),
  createSession: vi.fn(),
  listStudents: vi.fn(),
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

/** An owner who additionally holds the capability the reschedule action is gated on. */
function reschedulerSession(): Session {
  return makeSession("ACADEMY_OWNER", {
    permissions: [
      "session.read",
      "session.mark_attendance",
      "session.write_report",
      "session.reschedule",
    ],
  });
}

/** An owner who may add a one-off class (and cancel/gift it, so every status is offered). */
function creatorSession(): Session {
  return makeSession("ACADEMY_OWNER", {
    permissions: [
      "session.read",
      "session.mark_attendance",
      "session.write_report",
      "session.create",
      "session.cancel",
      "session.free",
    ],
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
    // The page writes the day it is showing into the URL, and jsdom keeps that between tests —
    // so reset it, or a deep-link test leaks its day into every test that follows.
    window.history.replaceState(null, "", "/attendance");
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

  // ── Reschedule a single occurrence from the day list ─────────────────────
  // The row action is offered only where the server would actually accept it: the viewer holds
  // `session.reschedule` AND the occurrence is still SCHEDULED (rescheduling mints a successor,
  // so a session that already moved or reached an outcome is rejected).

  it("moves a scheduled class to a new time, then reloads the day", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [daySession] });
    vi.mocked(api.rescheduleSession).mockResolvedValue({
      sessionId: "se2",
      originalSessionId: "se1",
      warnings: [],
    });
    renderManager(reschedulerSession());

    // Desktop table and mobile card both render the action; either drives the same modal.
    const [rescheduleBtn] = await screen.findAllByTestId("row-reschedule");
    await user.click(rescheduleBtn!);

    const when = await screen.findByTestId("reschedule-when");
    fireEvent.change(when, { target: { value: "2026-06-03T17:30" } });
    await user.click(screen.getByTestId("do-reschedule"));

    await waitFor(() => expect(api.rescheduleSession).toHaveBeenCalledTimes(1));
    const [sessionId, input] = vi.mocked(api.rescheduleSession).mock.calls[0]!;
    expect(sessionId).toBe("se1");
    // The wall-clock goes up with the viewer timezone so the server resolves it DST-correctly.
    expect(input.local_datetime).toBe("2026-06-03 17:30");
    expect(input.timezone).toBeTruthy();

    // The successor lives on another day, so the day view must refetch to reflect the move.
    await waitFor(() => expect(api.getSessionsByDay).toHaveBeenCalledTimes(2));
  });

  it("keeps the modal open on the warnings a successful move came back with", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [daySession] });
    vi.mocked(api.rescheduleSession).mockResolvedValue({
      sessionId: "se2",
      originalSessionId: "se1",
      warnings: [{ type: "conflict", message: "Overlaps another lesson." }],
    });
    renderManager(reschedulerSession());

    const [rescheduleBtn] = await screen.findAllByTestId("row-reschedule");
    await user.click(rescheduleBtn!);
    fireEvent.change(await screen.findByTestId("reschedule-when"), {
      target: { value: "2026-06-03T17:30" },
    });
    await user.click(screen.getByTestId("do-reschedule"));

    // Warnings are advisory — the move already landed, so it is reported as done and the
    // conflict is shown to read rather than swallowed by an immediate close.
    expect(await screen.findByTestId("reschedule-done")).toBeInTheDocument();
    expect(await screen.findByTestId("reschedule-warnings")).toHaveTextContent(
      "Overlaps another lesson.",
    );

    // Dismissing after the move still has to refetch — the row on screen is stale either way.
    await user.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(api.getSessionsByDay).toHaveBeenCalledTimes(2));
  });

  it("does not offer reschedule without the session.reschedule capability", async () => {
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [daySession] });
    renderManager(ownerSession());

    await screen.findByTestId("day-list");
    expect(screen.queryByTestId("row-reschedule")).not.toBeInTheDocument();
  });

  it("does not offer reschedule once the session has an outcome", async () => {
    vi.mocked(api.getSessionsByDay).mockResolvedValue({
      sessions: [{ ...daySession, status: "ATTENDED" as const }],
    });
    renderManager(reschedulerSession());

    await screen.findByTestId("day-list");
    expect(screen.queryByTestId("row-reschedule")).not.toBeInTheDocument();
  });

  // ── Deep link from the calendar ──────────────────────────────────────────

  it("keeps the deep-linked day in the URL so a refresh stays on it", async () => {
    window.history.replaceState(
      null,
      "",
      "/attendance?session=se1&date=2026-07-16&name=Abdullah",
    );
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [daySession] });
    renderManager();

    // The linked day must survive in the URL — dropping it sent a refresh back to today, which
    // silently swapped the day's rows out from under the user. The one-shot `session`/`name`
    // params must NOT survive, or every refresh would reopen the report popup.
    await waitFor(() =>
      expect(window.location.search).toBe("?date=2026-07-16"),
    );

    // The day actually fetched is the linked one, not today.
    const lastCall = vi.mocked(api.getSessionsByDay).mock.calls.at(-1)![0];
    expect(lastCall.from).toBe(new Date("2026-07-16T00:00:00").toISOString());
  });

  // ── Add a one-off class ──────────────────────────────────────────────────
  // The dialog owns no billing logic of its own: it composes the three endpoints a normal
  // session already uses (create → record outcome → save report), which is what makes the
  // class bill and report identically to a generated one.

  it("adds a class, records its outcome and saves its report, then reloads", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [] });
    vi.mocked(api.listTeachers).mockResolvedValue({
      rows: [{ id: "t1", full_name: "Ustadh" }] as never,
      total: 1,
      page: 1,
      pageSize: 100,
    });
    vi.mocked(api.listStudents).mockResolvedValue({
      rows: [{ id: "st1", full_name: "Abdullah" }] as never,
      total: 1,
      page: 1,
      pageSize: 200,
    });
    vi.mocked(api.createSession).mockResolvedValue({ sessionId: "new1", warnings: [] });
    vi.mocked(api.markAttendance).mockResolvedValue({
      status: "ATTENDED",
      billed: true,
      classification: {} as never,
    });
    vi.mocked(api.putSessionReport).mockResolvedValue({ ok: true, values: {} });

    renderManager(creatorSession());
    await user.click(await screen.findByTestId("create-class"));

    // Picking the teacher loads that teacher's roster — a class can only be added for one of
    // their own students.
    await user.selectOptions(await screen.findByTestId("create-class-teacher"), "t1");
    await waitFor(() =>
      expect(api.listStudents).toHaveBeenCalledWith(
        expect.objectContaining({ filter: { teacher_id: "t1" } }),
      ),
    );
    await user.selectOptions(await screen.findByTestId("create-class-student"), "st1");

    fireEvent.change(screen.getByTestId("create-class-when"), {
      target: { value: "2026-07-12T09:00" },
    });
    fireEvent.change(screen.getByTestId("create-class-duration"), {
      target: { value: "45" },
    });
    await user.selectOptions(screen.getByTestId("create-class-status"), "ATTENDED");
    await user.type(screen.getByTestId("create-class-description"), "Reviewed Surah Al-Mulk.");
    await user.click(screen.getByTestId("do-create-class"));

    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createSession).mock.calls[0]![0]).toMatchObject({
      student_id: "st1",
      teacher_id: "t1",
      local_datetime: "2026-07-12 09:00",
      duration_minutes: 45,
    });

    // The outcome goes through the SAME endpoint the attendance rows use, so the billing hook
    // fires and the invoice/payout pick the class up with no special-casing.
    await waitFor(() =>
      expect(api.markAttendance).toHaveBeenCalledWith(
        "new1",
        expect.objectContaining({ status: "ATTENDED" }),
      ),
    );
    // `report_text` is the reserved free-text key, so the report reads back like any other.
    await waitFor(() =>
      expect(api.putSessionReport).toHaveBeenCalledWith("new1", {
        report_text: "Reviewed Surah Al-Mulk.",
      }),
    );

    // The new class belongs to the day on screen, so the list refetches.
    await waitFor(() => expect(api.getSessionsByDay).toHaveBeenCalledTimes(2));
  });

  it("leaves a class with no outcome when it is added as Scheduled", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [] });
    vi.mocked(api.listTeachers).mockResolvedValue({
      rows: [{ id: "t1", full_name: "Ustadh" }] as never,
      total: 1,
      page: 1,
      pageSize: 100,
    });
    vi.mocked(api.listStudents).mockResolvedValue({
      rows: [{ id: "st1", full_name: "Abdullah" }] as never,
      total: 1,
      page: 1,
      pageSize: 200,
    });
    vi.mocked(api.createSession).mockResolvedValue({ sessionId: "new1", warnings: [] });

    renderManager(creatorSession());
    await user.click(await screen.findByTestId("create-class"));
    await user.selectOptions(await screen.findByTestId("create-class-teacher"), "t1");
    await user.selectOptions(await screen.findByTestId("create-class-student"), "st1");
    await user.selectOptions(screen.getByTestId("create-class-status"), "SCHEDULED");
    await user.click(screen.getByTestId("do-create-class"));

    await waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));
    // "Scheduled" means no outcome yet — recording one would be a lie about a lesson nobody marked.
    expect(api.markAttendance).not.toHaveBeenCalled();
  });

  it("does not offer to add a class without the session.create capability", async () => {
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [daySession] });
    renderManager(ownerSession());

    await screen.findByTestId("day-list");
    expect(screen.queryByTestId("create-class")).not.toBeInTheDocument();
  });
});
