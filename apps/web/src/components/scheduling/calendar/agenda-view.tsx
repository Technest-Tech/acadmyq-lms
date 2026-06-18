"use client";

import { CalendarX2, Clock, GraduationCap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { CalendarSession } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  bucketByDay,
  endUtc,
  STATUS_CHIP,
  STATUS_DOT,
  timeInTz,
  weekdayOf,
} from "./utils";

/**
 * The List/Agenda view: a flat, chronological feed grouped by day. Each row is a tap target
 * that opens the actions panel — the most legible view on mobile and for a quick scan of
 * "what's next". Days with no sessions are skipped; an empty range shows a friendly state.
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

  if (days.length === 0) {
    return (
      <div className="bg-card flex flex-col items-center justify-center gap-2 rounded-2xl border py-16 text-center shadow-sm">
        <CalendarX2 className="text-muted-foreground/60 size-8" aria-hidden />
        <p className="text-muted-foreground text-sm">{t("calendar.noSessions")}</p>
      </div>
    );
  }

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {days.map((day) => (
        <div key={day} data-day={day} className="border-b last:border-b-0">
          {/* Day header */}
          <div className="bg-muted/40 flex items-baseline gap-2 px-4 py-2">
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                day === today
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground",
              )}
            >
              {Number(day.slice(8, 10))}
            </span>
            <span className="text-sm font-semibold">
              {t(`weekday.${weekdayOf(day)}`)}
            </span>
            <span className="text-muted-foreground text-xs">{day}</span>
            {day === today && (
              <span className="bg-primary/10 text-primary ml-auto rounded-full px-2 py-0.5 text-[0.65rem] font-semibold">
                {t("calendar.today")}
              </span>
            )}
          </div>

          {/* Rows */}
          <ul>
            {byDay[day]!.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  data-testid={`session-${s.id}`}
                  data-status={s.status}
                  onClick={() => onSelect(s)}
                  className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-start transition-colors"
                >
                  <span
                    className={cn("h-9 w-1 shrink-0 rounded-full", STATUS_DOT[s.status])}
                    aria-hidden
                  />
                  <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-sm tabular-nums">
                    <Clock className="size-3.5" aria-hidden />
                    {timeInTz(s.scheduled_at_utc, tz, locale)}
                    <span className="text-muted-foreground/50">–</span>
                    {timeInTz(endUtc(s), tz, locale)}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <GraduationCap className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                    <span className="truncate text-sm font-medium">
                      {s.student_name ?? ""}
                    </span>
                    {s.teacher_name && (
                      <span className="text-muted-foreground hidden truncate text-xs sm:inline">
                        · {s.teacher_name}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium",
                      STATUS_CHIP[s.status],
                    )}
                  >
                    {t(`status.${s.status}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
