import { render, screen, waitFor, within } from "@testing-library/react";
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
  listStudents: vi.fn(),
  listTimetables: vi.fn(),
}));

import * as api from "@/lib/api";

const TZ = "Africa/Cairo";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
  new Date(),
);

// Two sessions on today: a 30-min lesson (the case the old grid clipped) and an overlapping
// 60-min one, plus a cancelled lesson — so lane-packing and the voided styling both get hit.
function feed() {
  return [
    {
      id: "se1",
      student_id: "s1",
      teacher_id: "t1",
      schedule_id: "sch1",
      scheduled_at_utc: `${today}T14:00:00Z`, // 17:00 Cairo
      duration_minutes: 30,
      status: "SCHEDULED" as const,
      status_reason: null,
      original_session_id: null,
      student_name: "Yusuf",
      teacher_name: "Teacher One",
    },
    {
      id: "se2",
      student_id: "s2",
      teacher_id: "t1",
      scheduled_at_utc: `${today}T14:15:00Z`, // overlaps se1
      schedule_id: null,
      duration_minutes: 60,
      status: "ATTENDED" as const,
      status_reason: null,
      original_session_id: null,
      student_name: "Mariam",
      teacher_name: "Teacher One",
    },
    {
      id: "se3",
      student_id: "s3",
      teacher_id: "t1",
      schedule_id: null,
      scheduled_at_utc: `${today}T09:00:00Z`,
      duration_minutes: 45,
      status: "CANCELLED_BY_STUDENT" as const,
      status_reason: null,
      original_session_id: null,
      student_name: "Omar",
      teacher_name: "Teacher One",
    },
  ];
}

function owner(): Session {
  return makeSession("ACADEMY_OWNER", {
    permissions: [
      "session.read",
      "session.reschedule",
      "session.cancel",
      "teacher.read",
      "student.read",
      "schedule.manage",
    ],
  });
}

function renderCal(session: Session = owner()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(session)}>
        <WeeklyCalendar timeZone={TZ} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

/**
 * The calendar's four views, exercised against one feed. These lock in the things a time grid
 * gets quietly wrong: a short lesson whose block is too small to render its own text, two
 * lessons that overlap, and a status that has to survive at any block size — plus the numbers
 * in the summary strip, which must always describe the sessions actually on screen.
 */
describe("calendar views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCalendar).mockResolvedValue({
      from: today,
      to: today,
      sessions: feed(),
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
          availability: [{ weekday: 0, start_local: "09:00", end_local: "17:00" }],
          is_active: true,
          deleted_at: null,
          created_at: "",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    vi.mocked(api.listStudents).mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    vi.mocked(api.listTimetables).mockResolvedValue({ timetables: [] });
  });

  it("week grid: overlapping + short sessions all render with their data", async () => {
    renderCal();
    const short = await screen.findByTestId("session-se1");
    // The 30-min block — the one the old 56px/hr grid clipped — still shows name + time.
    expect(short).toHaveTextContent("Yusuf");
    expect(short).toHaveTextContent("5:00");
    // Its overlapping neighbour is laid out too, not hidden behind it.
    expect(screen.getByTestId("session-se2")).toHaveTextContent("Mariam");
    expect(screen.getByTestId("session-se3")).toHaveAttribute(
      "data-status",
      "CANCELLED_BY_STUDENT",
    );
  });

  it("list view renders a full agenda row (start, end, teacher, status)", async () => {
    renderCal();
    await screen.findByTestId("session-se1");
    await userEvent.click(screen.getByTestId("view-list"));

    const agenda = await screen.findByTestId("agenda-view");
    const row = within(agenda).getByTestId("session-se1");
    expect(row).toHaveTextContent("Yusuf");
    expect(row).toHaveTextContent("5:00"); // start
    expect(row).toHaveTextContent("5:30"); // end — the old grid never showed this
    expect(row).toHaveTextContent("Teacher One");
    expect(row).toHaveTextContent("Scheduled");
  });

  it("status dropdown narrows the feed, and multi-select keeps both picks", async () => {
    renderCal();
    await screen.findByTestId("session-se1");
    const trigger = screen.getByTestId("status-filter-trigger");
    expect(trigger).toHaveTextContent("All");

    // Pick ATTENDED → only that session survives, and the trigger names it.
    await userEvent.click(trigger);
    await userEvent.click(screen.getByTestId("status-filter-ATTENDED"));
    await waitFor(() => {
      expect(screen.queryByTestId("session-se1")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("session-se2")).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Attended");
    expect(screen.getByTestId("filter-count")).toHaveTextContent("1");

    // The menu stays open, so a second status is one more click — not a reopen.
    await userEvent.click(screen.getByTestId("status-filter-SCHEDULED"));
    await waitFor(() => {
      expect(screen.getByTestId("session-se1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("session-se2")).toBeInTheDocument();
    expect(trigger).toHaveTextContent("2 statuses");

    // All resets and closes.
    await userEvent.click(screen.getByTestId("status-filter-all"));
    await waitFor(() => {
      expect(screen.getByTestId("session-se3")).toBeInTheDocument();
    });
    expect(trigger).toHaveTextContent("All");
    expect(screen.queryByTestId("status-filter-ATTENDED")).not.toBeInTheDocument();
  });

  it("no summary tiles on the calendar tab", async () => {
    renderCal();
    await screen.findByTestId("session-se1");
    expect(screen.queryByTestId("summary-total")).not.toBeInTheDocument();
    expect(screen.queryByTestId("summary-scheduled")).not.toBeInTheDocument();
    expect(screen.queryByTestId("summary-attended")).not.toBeInTheDocument();
    expect(screen.queryByTestId("summary-cancelled")).not.toBeInTheDocument();
  });

  it("owner gets a discoverable New-session button and a full-day toggle", async () => {
    renderCal();
    await screen.findByTestId("session-se1");
    expect(screen.getByTestId("calendar-new-session")).toBeInTheDocument();

    const toggle = screen.getByTestId("toggle-full-day");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("month view lays every session into its day cell", async () => {
    renderCal();
    await screen.findByTestId("session-se1");
    await userEvent.click(screen.getByTestId("view-month"));

    const cell = await screen.findByTestId("session-se1");
    expect(cell).toHaveTextContent("Yusuf");
    expect(screen.getByTestId("session-se3")).toHaveTextContent("Omar");
  });
});
