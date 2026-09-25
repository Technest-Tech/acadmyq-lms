import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { TeacherPunctuality } from "./teacher-punctuality";

// The Punctuality tab on a teacher's profile: the on-time rate and average delay, with the log of
// lessons (and every Enter press) behind them.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getTeacherPunctuality: vi.fn(),
}));

import * as api from "@/lib/api";

const data: api.TeacherPunctuality = {
  window: { from: "2026-08-28", to: "2026-09-26", timezone: "Africa/Cairo" },
  late_minutes: 5,
  opens_minutes_before: 10,
  has_meeting_url: true,
  tracking_since: "2026-09-01T00:00:00+00:00",
  totals: {
    lessons: 4, measured: 4, entered: 3,
    on_time: 2, late: 1, missed: 1, pending: 0,
    on_time_rate: 50, entered_rate: 75,
    avg_delay_minutes: 7.3, avg_late_minutes: 18,
  },
  sessions: [
    {
      id: "late", scheduled_at_utc: "2026-09-25T10:00:00+00:00", local_date: "2026-09-25", duration_minutes: 30,
      status: "ABSENT_UNEXCUSED", student_name: "Laila Pupil", bucket: "late",
      first_joined_at: "2026-09-25T10:18:00+00:00", delay_minutes: 18,
      joins: ["2026-09-25T10:18:00+00:00", "2026-09-25T10:25:00+00:00"],
    },
    {
      id: "early", scheduled_at_utc: "2026-09-25T09:00:00+00:00", local_date: "2026-09-25", duration_minutes: 30,
      status: "ATTENDED", student_name: "Omar Pupil", bucket: "on_time",
      first_joined_at: "2026-09-25T08:53:00+00:00", delay_minutes: -7, joins: ["2026-09-25T08:53:00+00:00"],
    },
    {
      id: "missed", scheduled_at_utc: "2026-09-25T11:00:00+00:00", local_date: "2026-09-25", duration_minutes: 30,
      status: "SCHEDULED", student_name: "Nour Pupil", bucket: "missed",
      first_joined_at: null, delay_minutes: null, joins: [],
    },
  ],
  truncated: false,
};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>
);

describe("TeacherPunctuality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTeacherPunctuality).mockResolvedValue(data);
  });

  it("shows the on-time rate and average delay with the counts behind them", async () => {
    render(wrap(<TeacherPunctuality teacherId="t1" />));

    await waitFor(() => expect(screen.getByTestId("punctuality-on-time")).toHaveTextContent("50%"));
    expect(screen.getByTestId("punctuality-on-time")).toHaveTextContent("2 of 4 lessons");
    expect(screen.getByTestId("punctuality-avg-delay")).toHaveTextContent("7.3 min");
    expect(screen.getByTestId("punctuality-avg-delay")).toHaveTextContent("When late: 18 min on average");
    expect(screen.getByTestId("punctuality-late")).toHaveTextContent("1");
    expect(screen.getByTestId("punctuality-late")).toHaveTextContent("25% of lessons");
    expect(screen.getByTestId("punctuality-missed")).toHaveTextContent("1");

    expect(api.getTeacherPunctuality).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ late_minutes: 5 }),
    );
  });

  it("logs each lesson with when the teacher entered it", async () => {
    render(wrap(<TeacherPunctuality teacherId="t1" />));

    const rows = await screen.findAllByTestId("punctuality-row");
    expect(rows).toHaveLength(3);

    const late = rows.find((r) => r.dataset.bucket === "late")!;
    expect(within(late).getByText("Late")).toBeInTheDocument();
    expect(late).toHaveTextContent("18 min after start");
    // Pressed twice — the first press is the one that counts, the count says there were more.
    expect(within(late).getByTestId("punctuality-presses")).toHaveTextContent("×2");

    const early = rows.find((r) => r.dataset.bucket === "on_time")!;
    expect(early).toHaveTextContent("7 min before start");

    const missed = rows.find((r) => r.dataset.bucket === "missed")!;
    expect(within(missed).getByText("Never entered")).toBeInTheDocument();
  });

  it("re-measures with a different lateness threshold", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherPunctuality teacherId="t1" />));
    await screen.findAllByTestId("punctuality-row");

    await user.click(screen.getByTestId("punctuality-late-10"));

    await waitFor(() =>
      expect(api.getTeacherPunctuality).toHaveBeenLastCalledWith(
        "t1",
        expect.objectContaining({ late_minutes: 10 }),
      ),
    );
  });

  it("says why there is nothing to measure when the teacher never had a link", async () => {
    vi.mocked(api.getTeacherPunctuality).mockResolvedValue({
      ...data,
      has_meeting_url: false,
      tracking_since: null,
      totals: {
        lessons: 0, measured: 0, entered: 0, on_time: 0, late: 0, missed: 0, pending: 0,
        on_time_rate: null, entered_rate: null, avg_delay_minutes: null, avg_late_minutes: null,
      },
      sessions: [],
    });
    render(wrap(<TeacherPunctuality teacherId="t1" />));

    expect(await screen.findByTestId("punctuality-no-link")).toBeInTheDocument();
    expect(screen.getByTestId("punctuality-on-time")).toHaveTextContent("—");
    expect(screen.getByText("No lessons in this period.")).toBeInTheDocument();
  });
});
