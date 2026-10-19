import type {
  GroupAttendanceStatus,
  GroupLesson,
  GroupLessonStatus,
  GroupSlot,
  GroupState,
} from "@/lib/groups-api";

/**
 * Small, pure helpers shared by the group screens (docs/groups). Every time on these screens is
 * shown in the GROUP's timezone — the weekly times were defined there, so "Monday 17:00" must read
 * 17:00 to the academy whatever the viewer's laptop says.
 */

export const fieldClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 h-10 w-full rounded-xl border px-3 text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-60";

export const textareaClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 min-h-20 w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:ring-3";

/** Today as "YYYY-MM-DD" in `tz`. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function lessonDate(iso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function lessonTime(iso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "YYYY-MM-DD HH:MM" in `tz` — what a reschedule form pre-fills. */
export function localDateTime(iso: string, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** A "17:00" wall-clock time in the reader's locale (12h for en, Arabic digits for ar). */
export function wallTime(hhmm: string, locale: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.UTC(2026, 0, 1, h ?? 0, m ?? 0));
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(d);
}

/** The slots, sorted the way a week reads. */
export function sortSlots(slots: GroupSlot[]): GroupSlot[] {
  return [...slots].sort(
    (a, b) => a.weekday - b.weekday || a.start_time_local.localeCompare(b.start_time_local),
  );
}

/** Has this lesson's start passed? */
export function hasStarted(lesson: Pick<GroupLesson, "scheduled_at_utc">, now = Date.now()): boolean {
  return new Date(lesson.scheduled_at_utc).getTime() <= now;
}

/** A pending lesson whose time is over — the sheet the academy still owes. */
export function needsMarking(lesson: GroupLesson, now = Date.now()): boolean {
  return lesson.status === "SCHEDULED" && hasStarted(lesson, now);
}

export const STATE_TONE: Record<GroupState, string> = {
  RUNNING: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  UPCOMING: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  FINISHED: "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
  ARCHIVED: "border-zinc-400/30 bg-zinc-400/10 text-zinc-500 dark:text-zinc-400",
};

export const LESSON_TONE: Record<GroupLessonStatus | "OVERDUE", string> = {
  SCHEDULED: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  OVERDUE: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  HELD: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  CANCELLED: "border-zinc-400/30 bg-zinc-400/10 text-zinc-500 line-through dark:text-zinc-400",
};

export const ATTENDANCE_TONE: Record<GroupAttendanceStatus, { on: string; off: string }> = {
  PRESENT: {
    on: "border-emerald-600 bg-emerald-600 text-white",
    off: "border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300",
  },
  LATE: {
    on: "border-amber-500 bg-amber-500 text-white",
    off: "border-amber-500/30 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300",
  },
  ABSENT: {
    on: "border-rose-600 bg-rose-600 text-white",
    off: "border-rose-500/30 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300",
  },
  EXCUSED: {
    on: "border-violet-600 bg-violet-600 text-white",
    off: "border-violet-500/30 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300",
  },
};

export const ATTENDANCE_STATUSES: GroupAttendanceStatus[] = ["PRESENT", "LATE", "ABSENT", "EXCUSED"];

/** A 0–1 rate as a whole percent. */
export function percent(rate: number | null | undefined): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}
