import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { LeadRow } from "@/lib/api";
import { setAcademyClock } from "@/lib/academy-clock";
import { BookLeadTrialForm } from "@/components/crm/book-lead-trial-form";
import { StudentTimeNote } from "./student-clock";

/** A trial booked on the academy's clock, read at the student's home too (Ahmed 2026-11-17). */

const bookLeadTrial = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listCrmTeachers: () => Promise.resolve({ teachers: [{ id: "t1", full_name: "Mona" }], durations: [30], timezone: "Africa/Cairo" }),
  bookLeadTrial: (id: string, input: unknown) => bookLeadTrial(id, input),
}));

vi.mock("@/lib/clock-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/clock-api")>()),
  getClockZones: vi.fn().mockResolvedValue({
    timezone: "Africa/Cairo",
    country: "EG",
    countries: {
      EG: [{ timezone: "Africa/Cairo", city: "Cairo", city_ar: null }],
      SA: [{ timezone: "Asia/Riyadh", city: "Riyadh", city_ar: null }],
    },
  }),
}));

const ar = arMessages.trials.studentClock;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z")); // winter: Cairo +2, Riyadh +3
  setAcademyClock("Africa/Cairo");
  bookLeadTrial.mockReset();
  bookLeadTrial.mockResolvedValue({ trialId: "tr1", warnings: [] });
});

afterEach(() => {
  vi.useRealTimers();
  setAcademyClock(null);
});

describe("StudentTimeNote", () => {
  it("says the hour at the student's home and the gap, and nothing on the academy's own clock", () => {
    // 17:00 in Cairo = 18:00 in Riyadh.
    const at = "2026-11-20T15:00:00Z";
    const { rerender } = render(withAuth(makeSession("ACADEMY_OWNER"), <StudentTimeNote timezone="Asia/Riyadh" country="SA" at={at} />));
    const note = screen.getByTestId("student-time-note");
    expect(note.textContent).toContain(ar.at.replace("{time}", "").trim());
    expect(note.textContent).toContain("٦:٠٠");
    expect(note.textContent).toContain("+١ ساعة");

    rerender(withAuth(makeSession("ACADEMY_OWNER"), <StudentTimeNote timezone="Africa/Cairo" at={at} />));
    expect(screen.queryByTestId("student-time-note")).not.toBeInTheDocument();
  });
});

describe("BookLeadTrialForm", () => {
  it("reads the lead's clock off their number and books the trial with it", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    const lead = { id: "l1", full_name: "Sara", whatsapp_phone: "+966501112223", trial_id: null, trial_teacher_id: "t1" } as unknown as LeadRow;
    render(withAuth(makeSession("ACADEMY_OWNER"), <BookLeadTrialForm lead={lead} onCancel={() => {}} onBooked={() => {}} />));

    // A Saudi number: the trial is shown at the lead's hour beside the academy's.
    await waitFor(() => expect(screen.getAllByTestId("student-time-note").length).toBeGreaterThan(0));

    await user.click(screen.getByTestId("crm-trial-submit"));
    await waitFor(() => expect(bookLeadTrial).toHaveBeenCalledTimes(1));
    expect(bookLeadTrial.mock.calls[0]?.[1]).toMatchObject({ teacher_id: "t1", student_timezone: "Asia/Riyadh" });
  });
});
