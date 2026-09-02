"use client";

import { AlarmClock, ChevronDown, Clock, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getOverdueSessions, type OverdueSession } from "@/lib/api";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** How many rows the panel shows before it has to be expanded. */
const COLLAPSED_ROWS = 5;

export interface OverdueState {
  sessions: OverdueSession[];
  count: number;
  truncated: boolean;
  graceHours: number;
  loading: boolean;
  reload: () => void;
}

/**
 * The overdue worklist behind the panel below and the dashboard's urgent card. One fetch, shared
 * by whoever needs the number, so the hero badge and the list can never disagree.
 *
 * `refreshKey` is any value the caller bumps when a lesson may have been marked (closing the
 * attendance popup, saving a reschedule) — the list re-reads and a lesson that just got its
 * outcome drops out of it.
 */
export function useOverdueLessons(refreshKey: unknown = 0): OverdueState {
  const [sessions, setSessions] = useState<OverdueSession[]>([]);
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [graceHours, setGraceHours] = useState(4);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getOverdueSessions()
      .then((r) => {
        if (!alive) return;
        setSessions(r.sessions);
        setCount(r.count);
        setTruncated(r.truncated);
        setGraceHours(r.grace_hours);
      })
      // The panel is an extra signal on top of the page, never the page itself: if it cannot
      // load, it stays silent rather than pushing an error banner over the day's worklist.
      .catch(() => {
        if (!alive) return;
        setSessions([]);
        setCount(0);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, tick]);

  return { sessions, count, truncated, graceHours, loading, reload };
}

/**
 * الحصص المعلقة — the lessons that ended hours ago and STILL carry no outcome.
 *
 * The day/week/month worklist above it can only ever show the window you are looking at, so a
 * lesson nobody marked three weeks ago is invisible there the moment the page moves on. This panel
 * is deliberately outside that window and deliberately loud: it is the one thing on the page that
 * says "these are already late", oldest first.
 *
 * It renders nothing at all when the backlog is empty — an admin with a clean slate should not be
 * shown a green "no problems" box every single day.
 */
export function OverdueLessonsPanel({
  state,
  onOpen,
  isTeacher,
}: {
  state: OverdueState;
  /** Open the attendance/report popup for one lesson. */
  onOpen: (s: OverdueSession) => void;
  /** A teacher sees their OWN backlog, so the copy addresses them rather than about them. */
  isTeacher: boolean;
}) {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);

  const stampFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );

  if (state.loading || state.count === 0) return null;

  const shown = expanded ? state.sessions : state.sessions.slice(0, COLLAPSED_ROWS);
  const hidden = state.sessions.length - shown.length;

  return (
    <section
      data-testid="overdue-panel"
      aria-label={t("overdueTitle")}
      className="overflow-hidden rounded-2xl border-2 border-rose-300 bg-rose-50/70 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/20"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-rose-200 px-5 py-3.5 dark:border-rose-900/50">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 ring-1 ring-rose-500/25">
          <AlarmClock className="size-4 text-rose-600 dark:text-rose-400" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-rose-900 dark:text-rose-100">
            {t("overdueTitle")}
            <span
              data-testid="overdue-count"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold tabular-nums text-white"
            >
              {state.count.toLocaleString()}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-rose-700/90 dark:text-rose-300/90">
            {t(isTeacher ? "overdueSubtitleTeacher" : "overdueSubtitle", {
              hours: state.graceHours,
            })}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-rose-200/70 dark:divide-rose-900/40">
        {shown.map((s) => {
          // "Late by" is measured from when the lesson ENDED, which is the moment the clock the
          // grace window runs on actually starts.
          const endedAt = new Date(
            new Date(s.scheduled_at_utc).getTime() + s.duration_minutes * 60_000,
          ).toISOString();
          return (
            <li
              key={s.id}
              data-testid="overdue-row"
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 transition-colors hover:bg-rose-100/50 dark:hover:bg-rose-900/20"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-rose-950 dark:text-rose-50">
                  {s.student_name ?? "—"}
                </p>
                <p className="mt-0.5 truncate text-xs text-rose-700/80 dark:text-rose-300/80">
                  {!isTeacher && s.teacher_name ? `${s.teacher_name} · ` : ""}
                  {stampFmt.format(new Date(s.scheduled_at_utc))}
                  {" · "}
                  {s.duration_minutes} {t("min")}
                </p>
              </div>

              {/* Who is actually holding this lesson up. A pending cancellation/free request means
                  the teacher already acted and the OWNER owes an approval — chasing the teacher
                  for it would be chasing the wrong person. */}
              {s.pending_approval ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                  <Clock className="size-2.5" aria-hidden />
                  {t("awaitingApproval")}
                </span>
              ) : (
                <span
                  data-testid="overdue-late-by"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-600/10 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300"
                >
                  <TriangleAlert className="size-2.5" aria-hidden />
                  {t("overdueLateBy", { when: formatRelativeTime(endedAt, locale) })}
                </span>
              )}

              <Button
                type="button"
                size="xs"
                data-testid="overdue-record"
                className="shrink-0 border-transparent bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => onOpen(s)}
              >
                {t("record")}
              </Button>
            </li>
          );
        })}
      </ul>

      {(hidden > 0 || expanded || state.truncated) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rose-200 px-5 py-2.5 dark:border-rose-900/50">
          {(hidden > 0 || expanded) && (
            <button
              type="button"
              data-testid="overdue-toggle"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline dark:text-rose-300"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
                aria-hidden
              />
              {expanded ? t("overdueShowLess") : t("overdueShowAll", { count: hidden })}
            </button>
          )}
          {state.truncated && (
            <p className="text-[11px] text-rose-700/80 dark:text-rose-300/80">
              {t("overdueTruncated", { shown: state.sessions.length, total: state.count })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
