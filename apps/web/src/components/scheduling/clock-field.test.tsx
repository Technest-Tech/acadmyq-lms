import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import { ClockField } from "@/components/scheduling/clock-field";
import { setAcademyClock } from "@/lib/academy-clock";

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

function show(props: Partial<Parameters<typeof ClockField>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ClockField
        value=""
        slots={[{ weekday: 6, start_time_local: "23:30" }]}
        onChange={onChange}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return onChange;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T08:00:00Z")); // winter: Cairo +2, Riyadh +3
  setAcademyClock("Africa/Cairo");
});

afterEach(() => {
  vi.useRealTimers();
  setAcademyClock(null);
});

describe("ClockField", () => {
  it("starts on the academy's clock and offers the student's country when they live abroad", async () => {
    const onChange = show({ studentCountry: "SA", studentTimezone: "Asia/Riyadh" });

    expect(screen.getByTestId("clock-academy")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(await screen.findByTestId("clock-suggest"));

    // Saturday 23:30 in Cairo is Sunday 00:30 in Riyadh: the slot is re-read, the lesson does not move.
    expect(onChange).toHaveBeenCalledWith("Asia/Riyadh", [{ weekday: 0, start_time_local: "00:30" }]);
  });

  it("shows the academy's own hour beside a timetable tied to the student's country", async () => {
    show({ value: "Asia/Riyadh", slots: [{ weekday: 0, start_time_local: "21:00" }] });

    expect(screen.getByTestId("clock-student")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByTestId("clock-academy-times")).toHaveTextContent(/Sun.*8:00/));
  });

  it("goes back to the academy's clock with the times re-read on it", async () => {
    const onChange = show({ value: "Asia/Riyadh", slots: [{ weekday: 0, start_time_local: "21:00" }] });

    fireEvent.click(screen.getByTestId("clock-academy"));
    expect(onChange).toHaveBeenCalledWith("", [{ weekday: 0, start_time_local: "20:00" }]);
  });

  it("treats a timetable saved under the academy's own zone as the academy's clock", async () => {
    show({ value: "Africa/Cairo" });
    await waitFor(() => expect(screen.getByTestId("clock-academy")).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByTestId("clock-academy-times")).toBeNull();
  });
});
