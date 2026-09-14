import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { SupervisionStats } from "./supervision-stats";

// The Supervision page: the period's follow/mark percentages, the per-person table, and the
// lesson list every number can be traced back to.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getSupervisionStats: vi.fn(),
}));

import * as api from "@/lib/api";

const stats: api.SupervisionStats = {
  window: { from: "2026-09-13", to: "2026-09-13", timezone: "Africa/Cairo" },
  thresholds: { follow_minutes: 10, mark_minutes: 60 },
  totals: {
    sessions: 4,
    needing_follow: 3, followed: 2, follow_on_time: 1, follow_late: 1, follow_pending: 0, unfollowed: 1,
    marked: 3, mark_on_time: 2, mark_late: 1, mark_pending: 0, unmarked: 1,
    avg_follow_delay_minutes: 14, avg_mark_delay_minutes: 66.7,
  },
  supervisors: [
    {
      id: "sara", name: "Sara Supervisor", role: "SUPERVISOR",
      followed: 2, follow_on_time: 1, follow_late: 1, follow_on_time_rate: 50, avg_follow_delay_minutes: 14,
      marked: 1, mark_on_time: 1, mark_late: 0, mark_on_time_rate: 100, avg_mark_delay_minutes: 20,
    },
    {
      id: "mona", name: "Mona Teacher", role: "TEACHER",
      followed: 0, follow_on_time: 0, follow_late: 0, follow_on_time_rate: null, avg_follow_delay_minutes: null,
      marked: 1, mark_on_time: 0, mark_late: 1, mark_on_time_rate: 0, avg_mark_delay_minutes: 180,
    },
  ],
  sessions: [
    {
      id: "a", scheduled_at_utc: "2026-09-13T08:00:00+00:00", local_date: "2026-09-13", duration_minutes: 30, status: "ATTENDED",
      student_name: "Omar Pupil", teacher_name: "Mona Teacher", needs_follow: true,
      follow_bucket: "on_time", followed_at: "2026-09-13T08:03:00+00:00", follow_delay_minutes: 3,
      followed_by: { id: "sara", name: "Sara Supervisor" },
      follow_ups: [{ user_id: "sara", name: "Sara Supervisor", followed_at: "2026-09-13T08:03:00+00:00", delay_minutes: 3 }],
      mark_bucket: "on_time", outcome_set_at: "2026-09-13T08:50:00+00:00", mark_delay_minutes: 20,
      marked_by: { id: "sara", name: "Sara Supervisor" },
    },
    {
      id: "b", scheduled_at_utc: "2026-09-13T09:00:00+00:00", local_date: "2026-09-13", duration_minutes: 30, status: "ABSENT_UNEXCUSED",
      student_name: "Laila Pupil", teacher_name: "Mona Teacher", needs_follow: true,
      follow_bucket: "late", followed_at: "2026-09-13T09:25:00+00:00", follow_delay_minutes: 25,
      followed_by: { id: "sara", name: "Sara Supervisor" },
      follow_ups: [{ user_id: "sara", name: "Sara Supervisor", followed_at: "2026-09-13T09:25:00+00:00", delay_minutes: 25 }],
      mark_bucket: "late", outcome_set_at: "2026-09-13T12:30:00+00:00", mark_delay_minutes: 180,
      marked_by: { id: "mona", name: "Mona Teacher" },
    },
    {
      id: "d", scheduled_at_utc: "2026-09-13T11:00:00+00:00", local_date: "2026-09-13", duration_minutes: 30, status: "SCHEDULED",
      student_name: "Nour Pupil", teacher_name: "Mona Teacher", needs_follow: true,
      follow_bucket: "none", followed_at: null, follow_delay_minutes: null, followed_by: null, follow_ups: [],
      mark_bucket: "none", outcome_set_at: null, mark_delay_minutes: null, marked_by: null,
    },
  ],
  truncated: false,
};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>
);

describe("SupervisionStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSupervisionStats).mockResolvedValue(stats);
  });

  it("shows the period's percentages with the counts behind them", async () => {
    render(wrap(<SupervisionStats />));

    // Followed 2 of the 3 that needed it; 1 of those 2 on time; marked 3 of 4; 2 of 3 on time.
    expect(await screen.findByTestId("tile-followed")).toHaveTextContent("67%");
    expect(screen.getByTestId("tile-followed")).toHaveTextContent("1 on time · 1 late · 1 nobody");
    expect(screen.getByTestId("tile-follow-on-time")).toHaveTextContent("50%");
    expect(screen.getByTestId("tile-follow-on-time")).toHaveTextContent("avg 14 min after start");
    expect(screen.getByTestId("tile-marked")).toHaveTextContent("75%");
    expect(screen.getByTestId("tile-mark-on-time")).toHaveTextContent("67%");

    expect(api.getSupervisionStats).toHaveBeenCalledWith(
      expect.objectContaining({ follow_minutes: 10, mark_minutes: 60 }),
    );
  });

  it("lists each person with their role and rates, and narrows the lessons to a chosen person", async () => {
    const user = userEvent.setup();
    render(wrap(<SupervisionStats />));

    const sara = await screen.findByTestId("person-sara");
    expect(sara).toHaveTextContent("Supervisor");
    expect(sara).toHaveTextContent("1 · 50%");
    expect(screen.getByTestId("person-mona")).toHaveTextContent("Teacher");

    // Everyone: all three lessons, with their follow and mark verdicts.
    const all = screen.getByTestId("supervision-sessions");
    expect(within(all).getAllByTestId("supervision-row")).toHaveLength(3);
    expect(within(all).getByText("Nour Pupil").closest("tr")).toHaveTextContent("Nobody");
    expect(within(all).getByText("Laila Pupil").closest("tr")).toHaveTextContent("25 min after start");
    expect(within(all).getByText("Laila Pupil").closest("tr")).toHaveTextContent("180 min after end");

    // Mona only marked one lesson — that is all her list holds.
    await user.click(screen.getByTestId("person-mona"));
    await waitFor(() => expect(within(screen.getByTestId("supervision-sessions")).getAllByTestId("supervision-row")).toHaveLength(1));
    expect(screen.getByText("Lessons — Mona Teacher")).toBeInTheDocument();
  });

  it("reloads when the period changes", async () => {
    const user = userEvent.setup();
    render(wrap(<SupervisionStats />));
    await screen.findByTestId("tile-lessons");

    await user.click(screen.getByTestId("period-last30"));
    await waitFor(() => expect(api.getSupervisionStats).toHaveBeenCalledTimes(2));
    const last = vi.mocked(api.getSupervisionStats).mock.calls.at(-1)![0];
    expect(last.from < last.to).toBe(true);
  });
});
