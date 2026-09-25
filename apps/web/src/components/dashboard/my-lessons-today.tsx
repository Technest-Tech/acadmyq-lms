"use client";

import { CalendarCheck2, CheckCircle2, Link2Off, Video } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  EnterLessonButton,
  JOIN_OPENS_MINUTES_BEFORE,
  enterState,
  useNow,
} from "@/components/attendance/enter-lesson-button";
import { StatusBadge } from "@/components/attendance/status-badge";
import { getSessionsByDay, type DaySession } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Today's local-day window as ISO instants — the API takes the browser's own day bounds. */
function todayWindow(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * A teacher's lessons for today, each with its Enter button — the first thing on the page they
 * open every day. The button greys out until {@link JOIN_OPENS_MINUTES_BEFORE} minutes before the
 * lesson, lights up on its own when the time comes, and opens the teacher's meeting link.
 *
 * Renders nothing until the day has lessons: a teacher with a free day is not shown an empty card.
 */
export function MyLessonsToday() {
  const t = useTranslations("dashboard.today");
  const locale = useLocale();
  const now = useNow();
  const [lessons, setLessons] = useState<DaySession[] | null>(null);
  // A press shows on its row at once; the API row carries it from the next load on.
  const [entered, setEntered] = useState<Record<string, string>>({});

  useEffect(() => {
    getSessionsByDay(todayWindow())
      .then((r) => setLessons(r.sessions))
      .catch(() => setLessons([]));
  }, []);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  if (lessons === null || lessons.length === 0) return null;

  // One link per teacher, so every row carries the same one — or none.
  const noLink = lessons.every((l) => !l.meeting_url);

  return (
    <section
      className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5"
      data-testid="my-lessons-today"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
            <Video className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight">{t("title")}</h2>
            <p className="text-muted-foreground text-xs">
              {t("subtitle", { minutes: JOIN_OPENS_MINUTES_BEFORE })}
            </p>
          </div>
        </div>
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
          {lessons.length}
        </span>
      </div>

      {noLink && (
        <p
          className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="my-lessons-no-link"
        >
          <Link2Off className="size-4 shrink-0" aria-hidden />
          {t("noLink")}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {lessons.map((l) => {
          const state = enterState(l, now);
          const start = new Date(l.scheduled_at_utc);
          const end = new Date(start.getTime() + l.duration_minutes * 60_000);
          const joinedAt = entered[l.id] ?? l.teacher_joined_at ?? null;
          return (
            <li
              key={l.id}
              data-testid="my-lesson"
              data-state={state}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 transition-colors",
                state === "open" && "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20",
                (state === "ended" || state === "closed") && "opacity-70",
              )}
            >
              <span className="w-24 shrink-0 text-sm font-semibold tabular-nums" dir="ltr">
                {timeFmt.format(start)}–{timeFmt.format(end)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.student_name ?? "—"}</p>
                {joinedAt && (
                  <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" aria-hidden />
                    {t("enteredAt", { time: timeFmt.format(new Date(joinedAt)) })}
                  </p>
                )}
              </div>
              {l.status !== "SCHEDULED" && <StatusBadge status={l.status} />}
              {state === "ended" && !joinedAt && l.status === "SCHEDULED" && (
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <CalendarCheck2 className="size-3.5" aria-hidden />
                  {t("ended")}
                </span>
              )}
              <EnterLessonButton
                lesson={l}
                meetingUrl={l.meeting_url}
                now={now}
                onEntered={(at) => setEntered((m) => ({ ...m, [l.id]: at }))}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
