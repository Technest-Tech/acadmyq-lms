"use client";

import { CalendarX2, ChevronRight, Clock, GraduationCap, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { CalendarSession } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  addDays,
  bucketByDay,
  endUtc,
  isVoided,
  STATUS_CHIP,
  STATUS_RAIL,
  timeInTz,
  weekdayOf,
} from "./utils";

/**
 * The List view: a flat, chronological feed grouped by day — the most complete read of a
 * session (start, end, duration, student, teacher, status all on one row) and the most legible
 * view on a phone, where a time grid can't win. Days with no sessions are skipped entirely, so
 * scrolling this is scrolling real work rather than empty columns. Day headers stick as you go.
 */
export function AgendaView({
  sessions,
  tz,
  today,
  onSelect,
}: {
  sessions: CalendarSession[];
  tz: string;
  today: string;
  onSelect: (s: CalendarSession) => void;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const byDay = useMemo(() => bucketByDay(sessions, tz), [sessions, tz]);
  const days = useMemo(() => Object.keys(byDay).sort(), [byDay]);
  const tomorrow = addDays(today, 1);

  if (days.length === 0) {
    return (
      <div className="bg-card flex flex-col items-center justify-center gap-2 rounded-2xl border py-20 text-center shadow-sm">
        <CalendarX2 className="text-muted-foreground/50 size-9" aria-hidden />
        <p className="text-muted-foreground text-sm font-medium">
          {t("calendar.noSessions")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="bg-card overflow-hidden rounded-2xl border shadow-sm"
      data-testid="agenda-view"
    >
      {days.map((day) => {
        const items = byDay[day]!;
        const isToday = day === today;
        // "Today" / "Tomorrow" beat a bare date for the two days people actually act on.
        const relative = isToday
          ? t("calendar.today")
          : day === tomorrow
            ? t("calendar.tomorrow")
            : null;
        const totalMin = items.reduce((sum, s) => sum + s.duration_minutes, 0);

        return (
          <section key={day} data-day={day} className="border-b last:border-b-0">
            {/* Sticky day header */}
            <header
              className={cn(
                "bg-muted/50 sticky top-0 z-10 flex items-center gap-2.5 px-4 py-2 backdrop-blur",
                isToday && "bg-primary/[0.07]",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                  isToday
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-card text-foreground border",
                )}
              >
                {Number(day.slice(8, 10))}
              </span>
              <span className="text-sm font-semibold">
                {t(`weekday.${weekdayOf(day)}`)}
              </span>
              {relative && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase",
                    isToday
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {relative}
                </span>
              )}
              <span className="text-muted-foreground ms-auto shrink-0 text-xs font-medium tabular-nums">
                {t("calendar.sessionCount", { count: items.length })}
                <span className="text-muted-foreground/50 mx-1.5">·</span>
                {Math.round((totalMin / 60) * 10) / 10}
                {t("timetables.hoursShort")}
              </span>
            </header>

            {/* Rows */}
            <ul className="divide-y">
              {items.map((s) => {
                const voided = isVoided(s.status);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      data-testid={`session-${s.id}`}
                      data-status={s.status}
                      onClick={() => onSelect(s)}
                      className="hover:bg-muted/50 group flex w-full items-center gap-3 px-3 py-3 text-start transition-colors sm:px-4"
                    >
                      {/* Status rail */}
                      <span
                        className={cn(
                          "h-10 w-1 shrink-0 rounded-full",
                          STATUS_RAIL[s.status],
                          voided && "opacity-60",
                        )}
                        aria-hidden
                      />

                      {/* Time block — start over end, so the eye scans a single column */}
                      <span className="flex w-16 shrink-0 flex-col sm:w-20">
                        <span
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            voided && "text-muted-foreground line-through",
                          )}
                        >
                          {timeInTz(s.scheduled_at_utc, tz, locale)}
                        </span>
                        <span className="text-muted-foreground text-[0.7rem] tabular-nums">
                          {timeInTz(endUtc(s), tz, locale)}
                        </span>
                      </span>

                      {/* Who */}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={cn(
                            "truncate text-sm font-semibold",
                            voided && "text-muted-foreground line-through",
                          )}
                        >
                          {s.student_name ?? t("calendar.unnamedStudent")}
                        </span>
                        <span className="text-muted-foreground flex items-center gap-2 text-xs">
                          {s.teacher_name && (
                            <span className="flex min-w-0 items-center gap-1">
                              <GraduationCap className="size-3 shrink-0" aria-hidden />
                              <span className="truncate">{s.teacher_name}</span>
                            </span>
                          )}
                          <span className="flex shrink-0 items-center gap-1 tabular-nums">
                            <Clock className="size-3" aria-hidden />
                            {t("actions.durationMin", {
                              count: s.duration_minutes,
                            })}
                          </span>
                        </span>
                      </span>

                      {/* Status — or, for a trial, what it actually is. */}
                      <span
                        className={cn(
                          "hidden shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold sm:inline-flex",
                          STATUS_CHIP[s.status],
                        )}
                      >
                        {s.trial && <Sparkles className="size-3" aria-hidden />}
                        {s.trial ? t("calendar.trialEvent") : t(`status.${s.status}`)}
                      </span>

                      <ChevronRight
                        className="text-muted-foreground/40 group-hover:text-muted-foreground size-4 shrink-0 transition-colors rtl:rotate-180"
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
