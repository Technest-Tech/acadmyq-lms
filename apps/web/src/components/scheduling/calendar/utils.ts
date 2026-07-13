import type { SessionStatus } from "@academiq/contracts";
import type { CalendarSession } from "@/lib/api";

/** The four ways the premium calendar can present the same session feed. */
export type CalendarView = "month" | "week" | "day" | "list";

// ── Calendar-date (Y-m-d) math ──────────────────────────────────────────────
// All day arithmetic is done on the "Y-m-d" string anchored at noon UTC so a ±day
// shift can never slip across a DST boundary. getUTCDay on that anchor is the
// weekday of the calendar date (0=Sun … 6=Sat).

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/** Sunday that opens the week containing `ymd`. */
export function startOfWeek(ymd: string): string {
  return addDays(ymd, -weekdayOf(ymd));
}

/** First day of the month containing `ymd` (keeps the Y-m string, day=01). */
export function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** Shift by whole calendar months, clamping the day to the target month's length. */
export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split("-").map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** Today's calendar date in the viewer timezone. */
export function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** The six-week (42-day) grid that a month view paints, Sunday-aligned. */
export function monthGridDays(anchor: string): string[] {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

// ── Timezone-aware instant formatting ───────────────────────────────────────

export function dateInTz(utcIso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
    new Date(utcIso),
  );
}

export function timeInTz(utcIso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeStyle: "short",
    timeZone: tz,
  }).format(new Date(utcIso));
}

/** Trim a UTC ISO instant to the "YYYY-MM-DDTHH:mm" a datetime-local input expects, in tz. */
export function toLocalInput(utcIso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl renders midnight as "24" in some engines; fold it back to 00.
  const hour = String(Number(get("hour")) % 24).padStart(2, "0");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** Minutes past local midnight for an instant, in the viewer timezone. */
export function minutesIntoDay(utcIso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcIso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl renders midnight as "24" in some engines; fold it back to 0.
  const hour = get("hour") % 24;
  return hour * 60 + get("minute");
}

/** End-of-session instant (start + duration) as a UTC ISO string. */
export function endUtc(s: CalendarSession): string {
  return new Date(
    new Date(s.scheduled_at_utc).getTime() + s.duration_minutes * 60_000,
  ).toISOString();
}

// ── Status colour language ──────────────────────────────────────────────────

/** Soft bordered chip — the prototype's colour language (§5.5). */
export const STATUS_CHIP: Record<SessionStatus, string> = {
  SCHEDULED:
    "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/50 dark:text-blue-200",
  ATTENDED:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/50 dark:text-emerald-200",
  FREE:
    "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/50 dark:bg-teal-950/50 dark:text-teal-200",
  ABSENT_UNEXCUSED:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/50 dark:text-amber-200",
  ABSENT_EXCUSED:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700/50 dark:bg-slate-800/50 dark:text-slate-300",
  CANCELLED_BY_TEACHER:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-200",
  CANCELLED_BY_STUDENT:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-200",
  RESCHEDULED:
    "border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-800/50 dark:bg-purple-950/50 dark:text-purple-200",
};

/** Solid dot — for legends, month chips and agenda rows. */
export const STATUS_DOT: Record<SessionStatus, string> = {
  SCHEDULED: "bg-blue-500",
  ATTENDED: "bg-emerald-500",
  FREE: "bg-teal-500",
  ABSENT_UNEXCUSED: "bg-amber-500",
  ABSENT_EXCUSED: "bg-slate-400",
  CANCELLED_BY_TEACHER: "bg-red-500",
  CANCELLED_BY_STUDENT: "bg-red-500",
  RESCHEDULED: "bg-purple-500",
};

/**
 * The solid accent rail drawn down the leading edge of an event block. A saturated bar reads
 * the status at a glance even when the block is too short to show its status text — which is
 * the common case for a 30-minute lesson.
 */
export const STATUS_RAIL: Record<SessionStatus, string> = {
  SCHEDULED: "bg-blue-500",
  ATTENDED: "bg-emerald-500",
  FREE: "bg-teal-500",
  ABSENT_UNEXCUSED: "bg-amber-500",
  ABSENT_EXCUSED: "bg-slate-400",
  CANCELLED_BY_TEACHER: "bg-red-500",
  CANCELLED_BY_STUDENT: "bg-red-500",
  RESCHEDULED: "bg-purple-500",
};

/** Statuses that read as "this lesson did not happen" — rendered struck-through / faded. */
const VOID_STATUSES = new Set<SessionStatus>([
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
  "RESCHEDULED",
]);

export function isVoided(status: SessionStatus): boolean {
  return VOID_STATUSES.has(status);
}

/** Every status, in the order legends and summaries read them. */
export const STATUS_ORDER: SessionStatus[] = [
  "SCHEDULED",
  "ATTENDED",
  "FREE",
  "ABSENT_UNEXCUSED",
  "ABSENT_EXCUSED",
  "RESCHEDULED",
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
];

// ── Period titles ───────────────────────────────────────────────────────────
// Format the calendar-date strings via a noon-UTC anchor read back in UTC, so the label
// is the literal date with no browser-timezone drift.

function atNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

export function monthYearLabel(ymd: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(atNoon(ymd));
}

export function dayLongLabel(ymd: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(atNoon(ymd));
}

/** "Jun 8 – 14, 2026" style range for a Sunday-aligned week. */
export function weekRangeLabel(start: string, locale: string): string {
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const startFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(atNoon(start));
  const endFmt = new Intl.DateTimeFormat(locale, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(atNoon(end));
  return `${startFmt} – ${endFmt}`;
}

// ── The visible hour window ─────────────────────────────────────────────────

/** The hours a grid falls back to when it has nothing to show (a normal teaching day). */
export const DEFAULT_DAY_START = 8;
export const DEFAULT_DAY_END = 21;

/**
 * The band of hours the time grid actually paints. Rendering a full 24 hours means most of what
 * the user scrolls through is empty night — and it squeezes every event block down to where a
 * 30-minute lesson can no longer fit its own text. So the window is derived from the feed:
 * every session is guaranteed to be inside it, padded by an hour on each side, and it never
 * shrinks below the default teaching day. `full` opts back into the whole 24 hours.
 */
export function hourWindow(
  sessions: CalendarSession[],
  tz: string,
  full = false,
): { startHour: number; endHour: number } {
  if (full) return { startHour: 0, endHour: 24 };

  let lo = DEFAULT_DAY_START;
  let hi = DEFAULT_DAY_END;
  for (const s of sessions) {
    const start = minutesIntoDay(s.scheduled_at_utc, tz);
    // A session that runs past midnight is clamped to the end of the day — its block is drawn
    // to 24:00 rather than wrapping onto the next column.
    const end = Math.min(start + s.duration_minutes, 24 * 60);
    lo = Math.min(lo, Math.floor(start / 60));
    hi = Math.max(hi, Math.ceil(end / 60));
  }
  return {
    startHour: Math.max(0, lo - 1),
    endHour: Math.min(24, hi + 1),
  };
}

/** "9:00 AM – 9:30 AM" — the full span of a session in the viewer's timezone. */
export function rangeInTz(
  s: CalendarSession,
  tz: string,
  locale: string,
): string {
  return `${timeInTz(s.scheduled_at_utc, tz, locale)} – ${timeInTz(endUtc(s), tz, locale)}`;
}

/** Group sessions by their local calendar date (viewer tz), each list time-sorted. */
export function bucketByDay(
  sessions: CalendarSession[],
  tz: string,
): Record<string, CalendarSession[]> {
  const map: Record<string, CalendarSession[]> = {};
  for (const s of sessions) {
    const day = dateInTz(s.scheduled_at_utc, tz);
    (map[day] ??= []).push(s);
  }
  for (const day of Object.keys(map)) {
    map[day]!.sort((a, b) =>
      a.scheduled_at_utc.localeCompare(b.scheduled_at_utc),
    );
  }
  return map;
}
