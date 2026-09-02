"use client";

import { CalendarClock, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ScheduleSlot } from "@/lib/api";

/** Today as a local `Y-m-d`, matching the date input's own format. */
export function todayLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * How many lessons this timetable would NEWLY create in the past.
 *
 * A back-dated timetable is a legitimate, useful thing: the student was enrolled on the 1st and
 * only entered into the system on the 20th, and those three weeks of lessons still have to be
 * marked. But it is also exactly where a typo costs the most — a year keyed as 2025 instead of
 * 2026 quietly puts a hundred-odd lessons on the attendance page. So the number is shown before
 * anything is saved.
 *
 * `coveredFrom` is the date the timetable ALREADY starts from, and it is what keeps the warning
 * honest. Re-saving a timetable that has run since June must not announce "this creates fourteen
 * past lessons" — those fourteen exist, and the server will create none of them. Only the stretch
 * between the new start and the old one is new history.
 */
export function countPastLessons(
  slots: Pick<ScheduleSlot, "weekday">[],
  startDate: string,
  today: string = todayLocal(),
  coveredFrom?: string,
): number {
  // Count up to whichever comes first: today, or the day this timetable already covered from.
  const until = coveredFrom && coveredFrom < today ? coveredFrom : today;
  if (!startDate || startDate >= until || slots.length === 0) return 0;

  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${until}T00:00:00`);
  if (Number.isNaN(cursor.getTime())) return 0;

  let count = 0;
  while (cursor < end) {
    for (const slot of slots) {
      if (slot.weekday === cursor.getDay()) count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * "Starts from" — the date a timetable begins producing lessons, and the warning that says what
 * a past date is about to do. The timetable carries this rather than reading the subscription,
 * because the enrolment wizard saves the timetable BEFORE the pricing step: there is no
 * subscription to read at the moment it matters. The server still falls back to the
 * subscription's start date when this is left empty, so in the ordinary flow it is typed once.
 */
export function StartDateField({
  value,
  onChange,
  slots,
  coveredFrom,
  disabled,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  slots: Pick<ScheduleSlot, "weekday">[];
  /** The start date this timetable already has, so only NEW history is warned about. */
  coveredFrom?: string;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("scheduling");
  const past = countPastLessons(slots, value, todayLocal(), coveredFrom);

  return (
    <div className={className}>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
        {t("startDate")}
      </label>
      <input
        type="date"
        aria-label={t("startDate")}
        data-testid="schedule-start-date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-background focus:border-primary focus:ring-primary/15 h-9 w-full rounded-xl border px-3 text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
        {t("startDateHint")}
      </p>
      {past > 0 && (
        <p
          data-testid="backfill-warning"
          className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
          {t("startDateBackfill", { count: past })}
        </p>
      )}
    </div>
  );
}
