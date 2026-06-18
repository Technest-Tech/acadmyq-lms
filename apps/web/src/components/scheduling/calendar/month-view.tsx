"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { CalendarSession } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  bucketByDay,
  monthGridDays,
  startOfMonth,
  STATUS_DOT,
  timeInTz,
  weekdayOf,
} from "./utils";

const MAX_CHIPS = 3;

/**
 * The classic month grid: six Sunday-aligned weeks, today ringed, off-month days dimmed.
 * Each cell shows up to three event chips and a "+N more" affordance that drills into the
 * day view. Clicking a chip selects the session for the actions panel.
 */
export function MonthView({
  anchor,
  sessions,
  tz,
  today,
  onSelect,
  onDrillDay,
}: {
  anchor: string;
  sessions: CalendarSession[];
  tz: string;
  today: string;
  onSelect: (s: CalendarSession) => void;
  onDrillDay: (day: string) => void;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const byDay = useMemo(() => bucketByDay(sessions, tz), [sessions, tz]);
  const month = startOfMonth(anchor).slice(0, 7);

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="text-muted-foreground px-2 py-2 text-center text-[0.7rem] font-semibold tracking-wide uppercase"
          >
            <span className="hidden sm:inline">{t(`weekday.${i}`)}</span>
            <span className="sm:hidden">{t(`weekday.${i}`).slice(0, 1)}</span>
          </div>
        ))}
      </div>

      {/* 6 × 7 day grid */}
      <div className="grid grid-cols-7 [&>*]:border-t [&>*]:border-l [&>*:nth-child(7n+1)]:border-l-0">
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === month;
          const isToday = day === today;
          const items = byDay[day] ?? [];
          const isWeekend = weekdayOf(day) === 5 || weekdayOf(day) === 6;
          return (
            <div
              key={day}
              data-day={day}
              data-weekday={weekdayOf(day)}
              className={cn(
                "min-h-24 p-1.5 sm:min-h-28",
                !inMonth && "bg-muted/30",
                isWeekend && inMonth && "bg-muted/20",
              )}
            >
              <button
                type="button"
                onClick={() => onDrillDay(day)}
                className={cn(
                  "mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground",
                  !inMonth && !isToday && "text-muted-foreground/60",
                )}
                aria-label={day}
              >
                {Number(day.slice(8, 10))}
              </button>

              <div className="space-y-0.5">
                {items.slice(0, MAX_CHIPS).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    data-testid={`session-${s.id}`}
                    data-status={s.status}
                    onClick={() => onSelect(s)}
                    title={`${timeInTz(s.scheduled_at_utc, tz, locale)} · ${s.student_name ?? ""} · ${t(`status.${s.status}`)}`}
                    className="hover:bg-muted/70 flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-start text-[0.7rem] transition-colors"
                  >
                    <span
                      className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[s.status])}
                      aria-hidden
                    />
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {timeInTz(s.scheduled_at_utc, tz, locale)}
                    </span>
                    <span className="truncate font-medium">
                      {s.student_name ?? ""}
                    </span>
                  </button>
                ))}
                {items.length > MAX_CHIPS && (
                  <button
                    type="button"
                    onClick={() => onDrillDay(day)}
                    className="text-muted-foreground hover:text-foreground px-1 text-[0.7rem] font-medium"
                  >
                    {t("calendar.more", { count: items.length - MAX_CHIPS })}
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
