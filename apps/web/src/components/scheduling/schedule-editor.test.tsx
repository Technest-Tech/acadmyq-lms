import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleSection } from "./schedule-editor";
import enMessages from "../../../messages/en.json";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getStudentSchedule: vi.fn(),
  putStudentSchedule: vi.fn(),
  deleteStudentSchedule: vi.fn(),
}));

import * as api from "@/lib/api";

function renderSection(canManage = true) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ScheduleSection studentId="s1" canManage={canManage} onError={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("ScheduleSection (Sprint 5 §5.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getStudentSchedule).mockResolvedValue({
      schedule: {
        id: "sch1",
        student_id: "s1",
        teacher_id: "t1",
        timezone: "Africa/Cairo",
        start_date: "2026-06-01",
        is_active: true,
        version: 1,
      },
      slots: [
        {
          id: "sl1",
          weekday: 2,
          start_time_local: "17:00:00",
          duration_minutes: 30,
        },
      ],
    });
    vi.mocked(api.putStudentSchedule).mockResolvedValue({
      scheduleId: "sch1",
      generated: { created: 4, removed: 0 },
    });
    vi.mocked(api.deleteStudentSchedule).mockResolvedValue({
      ok: true,
      generated: { created: 0, removed: 3 },
    });
  });

  it("loads existing slots and marks the schedule active", async () => {
    renderSection();
    await screen.findByTestId("student-schedule");
    expect(screen.getByTestId("schedule-active")).toBeInTheDocument();
    // The Tuesday slot's time is shown in the editor.
    expect(screen.getByDisplayValue("17:00")).toBeInTheDocument();
  });

  it("adds a slot and saves the whole set, surfacing generation counts", async () => {
    renderSection();
    await screen.findByTestId("student-schedule");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("add-slot"));
    await user.click(screen.getByTestId("save-schedule"));

    expect(await screen.findByTestId("schedule-impact")).toHaveTextContent(
      "Future generated lessons",
    );
    expect(api.putStudentSchedule).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("confirm-schedule-impact"));

    await waitFor(() =>
      expect(api.putStudentSchedule).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({
          slots: expect.arrayContaining([
            expect.objectContaining({ weekday: 2, start_time_local: "17:00" }),
          ]),
        }),
      ),
    );
    // Two slots are sent (the original + the added one).
    const payload = vi.mocked(api.putStudentSchedule).mock.calls[0]![1];
    expect(payload.slots).toHaveLength(2);
    expect(await screen.findByTestId("schedule-notice")).toHaveTextContent(
      "4 created",
    );
  });

  it("deletes the schedule", async () => {
    renderSection();
    await screen.findByTestId("student-schedule");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("delete-schedule"));

    await waitFor(() =>
      expect(api.deleteStudentSchedule).toHaveBeenCalledWith("s1"),
    );
  });

  it("is read-only without schedule.manage", async () => {
    renderSection(false);
    await screen.findByTestId("student-schedule");
    expect(screen.queryByTestId("save-schedule")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-slot")).not.toBeInTheDocument();
  });
});
