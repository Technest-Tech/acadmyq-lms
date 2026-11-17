import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import { ClockChangeNotice, DeviceClockNotice, StudentClocksButton } from "@/components/scheduling/clock-notices";
import { deviceTimeZone, setAcademyClock, zoneOffsetMinutes } from "@/lib/academy-clock";
import { anchorTimetables, getClockChanges, type ClockChanges } from "@/lib/clock-api";

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    session: { academy: { name: "A", country: "EG", timezone: "Africa/Cairo" } },
    can: (p: string) => p === "schedule.manage",
  }),
}));

vi.mock("@/lib/clock-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/clock-api")>()),
  getClockChanges: vi.fn(),
  anchorTimetables: vi.fn().mockResolvedValue({ moved: 2, unchanged: 0 }),
}));

const CHANGES: ClockChanges = {
  timezone: "Africa/Cairo",
  country: "EG",
  no_country: 3,
  changes: [
    {
      date: "2027-04-30",
      past: false,
      places: [{ country: "EG", timezone: "Africa/Cairo", shift_minutes: 60, is_academy: true }],
      moving_on_academy_clock: 4,
      academy_shift_minutes: 60,
      moving_for_student: 2,
      student_shift_minutes: -60,
    },
  ],
  abroad: [
    {
      country: "SA",
      zones: [{ timezone: "Asia/Riyadh", city: "Riyadh", city_ar: null }],
      suggested: "Asia/Riyadh",
      gap_minutes: 60,
      on_own_clock: 4,
      on_academy_clock: [
        { schedule_id: "s1", student_id: "st1", student_name: "Omar", teacher_name: "T" },
        { schedule_id: "s2", student_id: "st2", student_name: "Sara", teacher_name: "T" },
      ],
    },
  ],
};

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getClockChanges).mockResolvedValue(CHANGES);
});

afterEach(() => {
  setAcademyClock(null);
  vi.clearAllMocks();
});

describe("clock notices", () => {
  it("tells a user whose device is on another clock that every time here is the academy's", () => {
    // An academy an hour and a half away from wherever this test runs.
    const away = zoneOffsetMinutes(deviceTimeZone()) === 330 ? "Asia/Kathmandu" : "Asia/Kolkata";
    setAcademyClock(away);
    wrap(<DeviceClockNotice />);
    expect(screen.getByTestId("device-clock-notice")).toHaveTextContent(/Your device's clock is/);

    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("device-clock-notice")).toBeNull();
  });

  it("stays quiet when the device and the academy agree", () => {
    setAcademyClock(deviceTimeZone());
    wrap(<DeviceClockNotice />);
    expect(screen.queryByTestId("device-clock-notice")).toBeNull();
  });

  it("announces the next clock change on a planning page, with who it moves", async () => {
    setAcademyClock("Africa/Cairo");
    wrap(<ClockChangeNotice pathname="/attendance" />);

    const card = await screen.findByTestId("clock-change-notice");
    expect(card).toHaveTextContent(/the clocks change in Egypt \(\+an hour\)/);
    expect(card).toHaveTextContent(/2 students get their lesson an hour earlier/);
    expect(card).toHaveTextContent(/4 timetables tied to the student's clock: an hour later/);
    expect(card).toHaveTextContent(/2 abroad are still on the academy's clock/);
  });

  it("with no change near, still says once that students abroad ride the academy's clock", async () => {
    setAcademyClock("Africa/Cairo");
    vi.mocked(getClockChanges).mockResolvedValue({ ...CHANGES, changes: [] });
    wrap(<ClockChangeNotice pathname="/calendar" />);

    expect(await screen.findByTestId("clock-abroad-nudge")).toHaveTextContent(/2 students abroad/);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("clock-abroad-nudge")).toBeNull();
  });

  it("does not load or show the change card on other pages", () => {
    wrap(<ClockChangeNotice pathname="/invoices" />);
    expect(getClockChanges).not.toHaveBeenCalled();
  });

  it("ties a country's students to their own clock from the tool, skipping the unticked", async () => {
    setAcademyClock("Africa/Cairo");
    wrap(<StudentClocksButton />);

    fireEvent.click(await screen.findByTestId("student-clocks"));
    const row = await screen.findByTestId("clock-country-SA");
    expect(row).toHaveTextContent(/an hour ahead of the academy/);
    expect(row).toHaveTextContent(/4 on their own clock/);

    // Open the list and leave Sara on the academy's clock.
    fireEvent.click(screen.getByText("2 on the academy's clock"));
    fireEvent.click(screen.getByLabelText(/Sara/));
    fireEvent.click(screen.getByTestId("clock-tie-SA"));

    await waitFor(() => expect(anchorTimetables).toHaveBeenCalledWith(["s1"], "Asia/Riyadh"));
    expect(screen.getByTestId("student-clocks-modal")).toHaveTextContent(/3 with no country/);
  });
});
