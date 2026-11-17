/**
 * The academy's clock: the ONE clock every lesson time is shown and typed on.
 *
 * The panel used to read the device's own timezone everywhere. After Egypt went back an hour on
 * 30 Oct 2026 about one device in ten was still on summer time (an old Windows, a phone set by
 * hand): those screens showed every lesson an hour late, disagreed with the timetable page, and
 * saved whatever was typed on them an hour early for everybody else.
 *
 * So the device decides nothing. The academy's timezone arrives with the session (/auth/me), is set
 * here once, and every screen that shows or builds an instant reads it from here. The server's own
 * time comes with it, so a device whose clock was moved by hand still gets "now" and "today" right.
 *
 * Outside a session (tests, the public pages) nothing is set and this falls back to the device,
 * which is what those always did.
 */

let zone: string | null = null;
let skewMs = 0;

/** A device clock this far out is wrong, not just slow to answer. */
const SKEW_FLOOR_MS = 2 * 60_000;

function isZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Called by the auth provider when the session lands (null clears it, e.g. on sign-out). */
export function setAcademyClock(
  timezone: string | null | undefined,
  serverTime?: string | null,
): void {
  zone = isZone(timezone) ? timezone : null;
  skewMs = 0;
  if (serverTime) {
    const server = new Date(serverTime).getTime();
    if (Number.isFinite(server)) {
      const gap = server - Date.now();
      skewMs = Math.abs(gap) > SKEW_FLOOR_MS ? gap : 0;
    }
  }
}

/** The device's own zone. Only for telling the user their device disagrees. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The zone every lesson time is read on. */
export function academyTimeZone(): string {
  return zone ?? deviceTimeZone();
}

/** Is the academy's clock known (a signed-in academy session)? */
export function hasAcademyClock(): boolean {
  return zone !== null;
}

/** The real "now": the device's, corrected when its clock is plainly wrong. */
export function academyNow(): Date {
  return new Date(Date.now() + skewMs);
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function partsIn(at: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some engines render midnight as 24.
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes a zone's clock is ahead of UTC at an instant (Cairo in winter: 120). */
export function zoneOffsetMinutes(timeZone: string, at: Date = academyNow()): number {
  const p = partsIn(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // The parts carry no seconds, so the instant is cut to its minute too: 13:01:45 against 15:01
  // would otherwise round to 119.
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** "YYYY-MM-DD" of an instant on the academy's clock. */
export function academyDay(at: string | Date): string {
  const p = partsIn(typeof at === "string" ? new Date(at) : at, academyTimeZone());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Today on the academy's clock. */
export function academyToday(): string {
  return academyDay(academyNow());
}

/** "HH:mm" (24h) of an instant on the academy's clock: what a time input holds. */
export function academyHm(at: string | Date): string {
  const p = partsIn(typeof at === "string" ? new Date(at) : at, academyTimeZone());
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" of an instant on the academy's clock: what a datetime-local input holds. */
export function academyInput(at: string | Date = academyNow()): string {
  return `${academyDay(at)}T${academyHm(at)}`;
}

/**
 * The instant a wall-clock time on the academy's clock stands for. Asked twice, because the
 * offset on the far side of a clock change is not the one the first guess was made with.
 */
export function academyInstant(day: string, hm = "00:00"): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const wall = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  const tz = academyTimeZone();
  let at = wall - zoneOffsetMinutes(tz, new Date(wall)) * 60_000;
  at = wall - zoneOffsetMinutes(tz, new Date(at)) * 60_000;
  return new Date(at);
}

/** The instant an academy day begins, as the ISO string the API takes for a window edge. */
export function academyDayStartIso(day: string): string {
  return academyInstant(day).toISOString();
}

/**
 * How the device disagrees with the academy's clock, or null when it does not.
 *  - `zone`: the device is set to another zone (abroad, or left on summer time), `minutes` ahead.
 *  - `clock`: the device's clock itself is wrong by `minutes` (set by hand).
 * Nothing on screen depends on either any more; this is only so the user knows why the times here
 * differ from the corner of their screen.
 */
export function deviceClockGap(): { kind: "zone" | "clock"; minutes: number } | null {
  if (zone === null) return null;
  const now = new Date();
  const zoneGap = -now.getTimezoneOffset() - zoneOffsetMinutes(zone, now);
  if (zoneGap !== 0) return { kind: "zone", minutes: zoneGap };
  const clockGap = Math.round(-skewMs / 60_000);
  return clockGap !== 0 ? { kind: "clock", minutes: clockGap } : null;
}

/** A formatter on the academy's clock. Use it for every instant that has a time of day. */
export function academyFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: academyTimeZone() });
}

/**
 * A weekly slot's day and time read on another clock, as of now: Sunday 20:00 in Cairo is Sunday
 * 21:00 in Riyadh in winter. The same sum the API does when it ties a timetable to a country.
 */
export function slotOnClock(
  weekday: number,
  hm: string,
  fromTimeZone: string,
  toTimeZone: string,
  at: Date = academyNow(),
): { weekday: number; time: string } {
  const [h, m] = hm.split(":").map(Number);
  const gap = zoneOffsetMinutes(toTimeZone, at) - zoneOffsetMinutes(fromTimeZone, at);
  const week = 7 * 1440;
  const position = (((weekday * 1440 + (h ?? 0) * 60 + (m ?? 0) + gap) % week) + week) % week;
  return {
    weekday: Math.floor(position / 1440),
    time: `${pad(Math.floor((position % 1440) / 60))}:${pad(position % 60)}`,
  };
}
