import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import type { Session } from "@/lib/api";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { WeeklyCalendar } from "./weekly-calendar";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getCalendar: vi.fn(),
  listTeachers: vi.fn(),
  rescheduleSession: vi.fn(),
  cancelSession: vi.fn(),
}));

// SessionActions deep-links to the Attendance page, so it holds a router. There's no app router
// mounted in jsdom — without this the details modal throws on render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/calendar",
}));

import * as api from "@/lib/api";

const TZ = "Africa/Cairo";

// A session placed in the current visible week (today's column), so the grid always shows it.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
  new Date(),
);
const sessionUtc = `${today}T14:00:00Z`; // 17:00 Cairo (June, +3)

function ownerSession(): Session {
  return makeSession("ACADEMY_OWNER", {
    permissions: [
      "session.read",
      "session.reschedule",
      "session.cancel",
      "teacher.read",
    ],
  });
}

function renderCalendar(session: Session = ownerSession()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(session)}>
        <WeeklyCalendar timeZone={TZ} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("WeeklyCalendar (Sprint 5 §5.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCalendar).mockResolvedValue({
      from: today,
      to: today,
      sessions: [
        {
          id: "se1",
          student_id: "s1",
          teacher_id: "t1",
          schedule_id: "sch1",
          scheduled_at_utc: sessionUtc,
          duration_minutes: 30,
          status: "SCHEDULED",
          status_reason: null,
          original_session_id: null,
          student_name: "Yusuf",
          teacher_name: "Teacher One",
        },
      ],
      trials: [],
    });
    vi.mocked(api.listTeachers).mockResolvedValue({
      rows: [
        {
          id: "t1",
          user_id: null,
          full_name: "Teacher One",
          phone: null,
          specialization: null,
          session_rate_minor: 5000,
          currency: "EGP",
          timezone: null,
          availability: [],
          is_active: true,
          deleted_at: null,
          created_at: "",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    vi.mocked(api.rescheduleSession).mockResolvedValue({
      sessionId: "se2",
      originalSessionId: "se1",
      warnings: [],
    });
    vi.mocked(api.cancelSession).mockResolvedValue({
      ok: true,
      status: "CANCELLED_BY_TEACHER",
    });
  });

  it("renders a session in the viewer timezone with its status", async () => {
    renderCalendar();
    const card = await screen.findByTestId("session-se1");
    expect(card).toHaveAttribute("data-status", "SCHEDULED");
    expect(card).toHaveTextContent("Yusuf");
    // 17:00 Cairo renders as 5:00 PM in English.
    expect(card).toHaveTextContent("5:00");
  });

  it("paints a booked trial next to the lessons, but never as one", async () => {
    // A trial is a real hour of a real teacher booked from the CRM. It has to be visible here or
    // it gets double-booked — and it must not answer to the session actions, whose endpoints
    // would rightly refuse a trial id.
    vi.mocked(api.getCalendar).mockResolvedValue({
      from: today,
      to: today,
      sessions: [],
      trials: [
        {
          id: "tr1",
          teacher_id: "t1",
          student_id: null,
          lead_id: "lead1",
          scheduled_at_utc: sessionUtc,
          duration_minutes: 30,
          status: "SCHEDULED",
          teacher_name: "Teacher One",
          student_name: null,
          crm_lead_name: "Sara Ahmed",
          lead_name: "Sara Ahmed",
          display_name: "Sara Ahmed",
        },
      ],
    });

    renderCalendar();
    const user = userEvent.setup();

    const card = await screen.findByTestId("session-tr1");
    expect(card).toHaveTextContent("Sara Ahmed");

    await user.click(card);
    // The trial card, not the session actions.
    expect(await screen.findByTestId("calendar-trial-card")).toBeInTheDocument();
    expect(screen.queryByTestId("open-reschedule")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-cancel")).not.toBeInTheDocument();
  });

  it("lets an owner filter by teacher (refetches with teacherId)", async () => {
    renderCalendar();
    await screen.findByTestId("session-se1");
    const user = userEvent.setup();

    // The teacher filter is now a searchable combobox: open it, then pick the teacher.
    await user.click(screen.getByTestId("calendar-teacher"));
    await user.click(await screen.findByRole("option", { name: "Teacher One" }));

    await waitFor(() =>
      expect(api.getCalendar).toHaveBeenLastCalledWith(
        expect.objectContaining({ teacherId: "t1" }),
      ),
    );
  });

  it("reschedules a session with the viewer timezone", async () => {
    renderCalendar();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("session-se1"));

    // The details modal opens on the lesson; the form is behind its action.
    await user.click(screen.getByTestId("open-reschedule"));
    await user.click(screen.getByTestId("do-reschedule"));

    await waitFor(() =>
      expect(api.rescheduleSession).toHaveBeenCalledWith(
        "se1",
        expect.objectContaining({ timezone: TZ }),
      ),
    );
  });

  it("cancels a session by teacher", async () => {
    renderCalendar();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("session-se1"));

    await user.click(screen.getByTestId("open-cancel"));
    await user.click(screen.getByTestId("cancel-by-teacher"));

    await waitFor(() =>
      expect(api.cancelSession).toHaveBeenCalledWith(
        "se1",
        expect.objectContaining({ cancelled_by: "teacher" }),
      ),
    );
  });

  it("keeps the destructive path behind a deliberate choice", async () => {
    renderCalendar();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("session-se1"));

    // Opening a lesson must not put "cancel" under the cursor.
    expect(screen.queryByTestId("cancel-by-teacher")).not.toBeInTheDocument();
    expect(screen.queryByTestId("do-reschedule")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("open-cancel"));
    expect(screen.getByTestId("cancel-by-teacher")).toBeInTheDocument();

    // ...and Back returns to the picker without cancelling anything.
    await user.click(screen.getByTestId("action-back"));
    expect(screen.queryByTestId("cancel-by-teacher")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-cancel")).toBeInTheDocument();
    expect(api.cancelSession).not.toHaveBeenCalled();
  });

  it("navigates to the next week and refetches a shifted range", async () => {
    renderCalendar();
    await screen.findByTestId("session-se1");
    const user = userEvent.setup();

    const firstFrom = vi.mocked(api.getCalendar).mock.calls[0]![0].from;
    await user.click(screen.getByTestId("next-week"));

    await waitFor(() => {
      const lastFrom = vi.mocked(api.getCalendar).mock.lastCall![0].from;
      expect(lastFrom > firstFrom).toBe(true);
    });
  });
});
