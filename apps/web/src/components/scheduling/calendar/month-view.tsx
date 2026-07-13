"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { CalendarSession } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  bucketByDay,
  isVoided,
  monthGridDays,
  startOfMonth,
  STATUS_CHIP,
  STATUS_RAIL,
  timeInTz,
  weekdayOf,
} from "./utils";

/** How many event chips a cell shows before it collapses the rest into "+N more". */
const MAX_CHIPS = 3;

/**
 * The classic month grid: six Sunday-aligned weeks, today ringed, off-month days dimmed. Each
 * cell shows up to three event chips — a status rail, the start time and the student — and a
 * "+N more" affordance that drills into the day view. Clicking a chip opens the session; an
 * owner hovering an empty cell gets a quick-create affordance.
 */
export function MonthView({
  anchor,
  sessions,
  tz,
  today,
  onSelect,
  onDrillDay,
  onCreateOn,
}: {
  anchor: string;
  sessions: CalendarSession[];
  tz: string;
  today: string;
  onSelect: (s: CalendarSession) => void;
  onDrillDay: (day: string) => void;
  /** Quick-create on a clicked day (owner only). Omitted for read-only viewers. */
  onCreateOn?: (day: string) => void;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const byDay = useMemo(() => bucketByDay(sessions, tz), [sessions, tz]);
  const month = startOfMonth(anchor).slice(0, 7);

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* Weekday header */}
      <div className="bg-muted/30 grid grid-cols-7 border-b">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="text-muted-foreground px-2 py-2.5 text-center text-[0.7rem] font-semibold tracking-wide uppercase"
          >
            <span className="hidden sm:inline">{t(`weekday.${i}`)}</span>
            <span className="sm:hidden">{t(`weekday.${i}`).slice(0, 1)}</span>
          </div>
        ))}
      </div>

      {/* 6 × 7 day grid */}
      <div className="grid grid-cols-7 [&>*]:border-t [&>*]:border-s [&>*:nth-child(7n+1)]:border-s-0">
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === month;
          const isToday = day === today;
          const items = byDay[day] ?? [];
          const isWeekend = weekdayOf(day) === 5 || weekdayOf(day) === 6;
          const hidden = items.length - MAX_CHIPS;
          return (
            <div
              key={day}
              data-day={day}
              data-weekday={weekdayOf(day)}
              className={cn(
                "group/day relative flex min-h-28 flex-col gap-1 p-1.5 transition-colors sm:min-h-32",
                !inMonth && "bg-muted/40",
                isWeekend && inMonth && "bg-muted/20",
                isToday && "bg-primary/[0.04]",
              )}
            >
              {/* Day number + the day's load */}
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => onDrillDay(day)}
                  title={t("calendar.openDay")}
                  className={cn(
                    "inline-flex size-6.5 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums transition-colors",
                    isToday
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "hover:bg-muted text-foreground",
                    !inMonth && !isToday && "text-muted-foreground/50",
                  )}
                  aria-label={day}
                >
                  {Number(day.slice(8, 10))}
                </button>

                {items.length > 0 ? (
                  <span
                    className={cn(
                      "text-muted-foreground shrink-0 text-[0.65rem] font-semibold tabular-nums",
                      !inMonth && "text-muted-foreground/50",
                    )}
                  >
                    {items.length}
                  </span>
                ) : (
                  onCreateOn && (
                    // Only surfaces on hover, so an empty month doesn't read as a wall of "+".
                    <button
                      type="button"
                      onClick={() => onCreateOn(day)}
                      aria-label={t("calendar.newSession")}
                      title={t("calendar.newSession")}
                      className="text-muted-foreground hover:bg-primary/10 hover:text-primary hidden size-5 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover/day:opacity-100 focus-visible:opacity-100 sm:inline-flex"
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </button>
                  )
                )}
              </div>

              {/* Event chips */}
              <div className="flex min-h-0 flex-1 flex-col gap-0.5">
                {items.slice(0, MAX_CHIPS).map((s) => {
                  const voided = isVoided(s.status);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      data-testid={`session-${s.id}`}
                      data-status={s.status}
                      onClick={() => onSelect(s)}
                      title={`${timeInTz(s.scheduled_at_utc, tz, locale)} · ${
                        s.student_name ?? ""
                      } · ${t(`status.${s.status}`)}`}
                      className={cn(
                        "relative flex w-full items-center gap-1 overflow-hidden rounded-md border py-0.5 pe-1 ps-2 text-start text-[0.7rem] transition-shadow hover:shadow-sm",
                        STATUS_CHIP[s.status],
                        voided && "opacity-70",
                        !inMonth && "opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute inset-y-0 w-1 ltr:left-0 rtl:right-0",
                          STATUS_RAIL[s.status],
                        )}
                        aria-hidden
                      />
                      <span className="shrink-0 font-bold tabular-nums opacity-80">
                        {timeInTz(s.scheduled_at_utc, tz, locale)}
                      </span>
                      <span
                        className={cn(
                          "truncate font-semibold",
                          voided && "line-through",
                        )}
                      >
                        {s.student_name ?? t("calendar.unnamedStudent")}
                      </span>
                    </button>
                  );
                })}

                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => onDrillDay(day)}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/60 mt-auto rounded-md px-1 py-0.5 text-start text-[0.7rem] font-semibold transition-colors"
                  >
                    {t("calendar.more", { count: hidden })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
