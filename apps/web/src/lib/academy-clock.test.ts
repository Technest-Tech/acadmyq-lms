import { afterEach, describe, expect, it, vi } from "vitest";
import {
  academyDay,
  academyDayStartIso,
  academyHm,
  academyInstant,
  academyNow,
  academyTimeZone,
  academyToday,
  deviceClockGap,
  deviceTimeZone,
  setAcademyClock,
  slotOnClock,
  zoneOffsetMinutes,
} from "@/lib/academy-clock";

afterEach(() => {
  setAcademyClock(null);
  vi.useRealTimers();
});

describe("the academy's clock", () => {
  it("falls back to the device until a session sets it, and ignores a made-up zone", () => {
    expect(academyTimeZone()).toBe(deviceTimeZone());
    setAcademyClock("Mars/Olympus");
    expect(academyTimeZone()).toBe(deviceTimeZone());
    setAcademyClock("Africa/Cairo");
    expect(academyTimeZone()).toBe("Africa/Cairo");
  });

  it("reads an instant on the academy's clock whatever the device is set to", () => {
    setAcademyClock("Africa/Cairo");
    // 22:06 UTC on 31 Oct 2026 is 00:06 on 1 Nov in Cairo (winter, +2).
    expect(academyDay("2026-10-31T22:06:00Z")).toBe("2026-11-01");
    expect(academyHm("2026-10-31T22:06:00Z")).toBe("00:06");
    // The same wall clock a day before Egypt went back was +3.
    expect(academyHm("2026-10-28T21:06:00Z")).toBe("00:06");
  });

  it("knows Egypt's offset on both sides of the 30 Oct 2026 change", () => {
    expect(zoneOffsetMinutes("Africa/Cairo", new Date("2026-10-20T12:00:00Z"))).toBe(180);
    expect(zoneOffsetMinutes("Africa/Cairo", new Date("2026-11-10T12:00:00Z"))).toBe(120);
    expect(zoneOffsetMinutes("Asia/Riyadh", new Date("2026-11-10T12:00:00Z"))).toBe(180);
    // Seconds past the minute do not shave a minute off the answer.
    expect(zoneOffsetMinutes("Africa/Cairo", new Date("2026-11-10T12:00:45.500Z"))).toBe(120);
  });

  it("turns a typed academy time into the right instant across a clock change", () => {
    setAcademyClock("Africa/Cairo");
    expect(academyInstant("2026-10-29", "17:00").toISOString()).toBe("2026-10-29T14:00:00.000Z");
    expect(academyInstant("2026-10-30", "17:00").toISOString()).toBe("2026-10-30T15:00:00.000Z");
    // A day starts at academy midnight: 21:00Z in summer, 22:00Z in winter.
    expect(academyDayStartIso("2026-10-29")).toBe("2026-10-28T21:00:00.000Z");
    expect(academyDayStartIso("2026-11-17")).toBe("2026-11-16T22:00:00.000Z");
  });

  it("takes today from the academy, not the device", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T22:30:00Z")); // 00:30 on the 17th in Cairo
    setAcademyClock("Africa/Cairo");
    expect(academyToday()).toBe("2026-11-17");
    setAcademyClock("America/Toronto");
    expect(academyToday()).toBe("2026-11-16");
  });

  it("corrects a device clock set by hand, and leaves a small gap alone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T09:00:00Z")); // the device believes it is 09:00Z
    setAcademyClock("Africa/Cairo", "2026-11-17T10:00:00Z"); // the server knows it is 10:00Z
    expect(academyNow().toISOString()).toBe("2026-11-17T10:00:00.000Z");
    expect(deviceClockGap()).toEqual(
      // A device in another zone reports that first; one in Cairo reports its clock an hour slow.
      -new Date().getTimezoneOffset() === 120 ? { kind: "clock", minutes: -60 } : expect.objectContaining({ kind: "zone" }),
    );

    setAcademyClock("Africa/Cairo", "2026-11-17T09:00:40Z");
    expect(academyNow().toISOString()).toBe("2026-11-17T09:00:00.000Z");
  });

  it("says nothing about the device outside an academy session", () => {
    expect(deviceClockGap()).toBeNull();
  });

  it("re-reads a weekly slot on another clock", () => {
    const winter = new Date("2026-11-17T08:00:00Z");
    // Sunday 20:00 Cairo is Sunday 21:00 Riyadh in winter…
    expect(slotOnClock(0, "20:00", "Africa/Cairo", "Asia/Riyadh", winter)).toEqual({ weekday: 0, time: "21:00" });
    // …and the same hour in summer, when Egypt is on +3 too.
    expect(slotOnClock(0, "20:00", "Africa/Cairo", "Asia/Riyadh", new Date("2026-07-01T08:00:00Z"))).toEqual({ weekday: 0, time: "20:00" });
    // Across midnight and the week's edge.
    expect(slotOnClock(6, "23:30", "Africa/Cairo", "Asia/Riyadh", winter)).toEqual({ weekday: 0, time: "00:30" });
    expect(slotOnClock(0, "05:00", "Africa/Cairo", "America/Toronto", winter)).toEqual({ weekday: 6, time: "22:00" });
  });
});
