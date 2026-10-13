/**
 * Calendar-day arithmetic for the trials board. Every day here is the ACADEMY's day — a
 * "YYYY-MM-DD" string read in the academy's timezone — never the viewer's, so an owner travelling
 * abroad still sees Tuesday's trials under Tuesday. Day strings are shifted through UTC noon, which
 * no DST change can push across a date line.
 */

/** "YYYY-MM-DD" of an instant, on the wall clock of `timeZone`. */
export function dayIn(iso: string | Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "HH:mm" (24h) of an instant, on the wall clock of `timeZone` — what a time input holds. */
export function hmIn(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

function toUtcNoon(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
}

export function addDays(day: string, n: number): string {
  const date = toUtcNoon(day);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return toUtcNoon(day).getUTCDay();
}

/**
 * The Saturday that opens the week `day` sits in. The academies this serves keep a Saturday-first
 * week (Friday is the weekend), so the strip reads Sat → Fri in both languages.
 */
export function weekStart(day: string): string {
  return addDays(day, -((weekdayOf(day) + 1) % 7));
}

/** A day string as a Date at UTC noon — for Intl formatting with `timeZone: "UTC"`. */
export function dayAsDate(day: string): Date {
  return toUtcNoon(day);
}
