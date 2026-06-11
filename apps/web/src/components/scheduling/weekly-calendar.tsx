"use client";

import type { SessionStatus } from "@academiq/contracts";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SessionActions } from "@/components/scheduling/session-actions";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  type CalendarSession,
  getCalendar,
  listTeachers,
  type TeacherRow,
} from "@/lib/api";

/** Tailwind classes per status — the prototype's colour language (§5.5). */
const STATUS_COLOR: Record<SessionStatus, string> = {
  SCHEDULED: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/50 dark:text-blue-200",
  ATTENDED: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/50 dark:text-emerald-200",
  ABSENT_UNEXCUSED: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/50 dark:text-amber-200",
  ABSENT_EXCUSED: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700/50 dark:bg-slate-800/50 dark:text-slate-300",
  CANCELLED_BY_TEACHER: "border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-200",
  CANCELLED_BY_STUDENT: "border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-200",
  RESCHEDULED: "border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-800/50 dark:bg-purple-950/50 dark:text-purple-200",
};

// Date math on calendar-date strings, anchored at noon UTC so a ±day shift never slips a DST
// boundary. getUTCDay on that anchor is the weekday of the calendar date (0=Sun … 6=Sat).
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}
function dateInTz(utcIso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
    new Date(utcIso),
  );
}
function timeInTz(utcIso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeStyle: "short",
    timeZone: tz,
  }).format(new Date(utcIso));
}

/**
 * The teacher weekly calendar (§5.5, AC-5.9). Seven day columns; each session renders as a
 * status-coloured card at its time in the VIEWER's timezone (the stored UTC never changes). A
 * teacher sees only their own week; an Owner can pick any teacher (the server enforces both).
 * Prev/next week navigation. Clicking a session opens reschedule/cancel (capability-gated).
 */
export function WeeklyCalendar({
  timeZone,
}: {
  /** Viewer timezone; defaults to the browser's resolved zone. */
  timeZone?: string;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const { can } = useAuth();
  const tz =
    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const canPickTeacher = can("teacher.read");
  const canAct = can("session.reschedule") || can("session.cancel");

  const [weekStart, setWeekStart] = useState(() => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      new Date(),
    );
    return addDays(today, -weekdayOf(today)); // back up to Sunday
  });
  const [teacherId, setTeacherId] = useState("");
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [selected, setSelected] = useState<CalendarSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCalendar({
        from: weekStart,
        to: addDays(weekStart, 6),
        teacherId: teacherId || undefined,
      });
      setSessions(res.sessions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [weekStart, teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canPickTeacher) return;
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [canPickTeacher]);

  // Bucket sessions by their local calendar date in the viewer timezone.
  const byDay = useMemo(() => {
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
  }, [sessions, tz]);

  return (
    <div className="space-y-4" data-testid="weekly-calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("calendar.title")}</h1>
        <div className="flex items-center gap-2">
          {canPickTeacher && (
            <select
              aria-label={t("calendar.teacher")}
              data-testid="calendar-teacher"
              className="border-input bg-background focus:border-primary focus:ring-primary/15 rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-3"
              value={teacherId}
              onChange={(e) => {
                setTeacherId(e.target.value);
                setSelected(null);
              }}
            >
              <option value="">{t("calendar.allTeachers")}</option>
              {teachers.map((tch) => (
                <option key={tch.id} value={tch.id}>
                  {tch.full_name}
                </option>
              ))}
            </select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="prev-week"
            onClick={() => {
              setSelected(null);
              setWeekStart((w) => addDays(w, -7));
            }}
          >
            ← {t("calendar.prev")}
          </Button>
          <span className="text-muted-foreground rounded-lg border px-3 py-1.5 text-sm font-medium" data-testid="week-range">
            {weekStart} → {addDays(weekStart, 6)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="next-week"
            onClick={() => {
              setSelected(null);
              setWeekStart((w) => addDays(w, 7));
            }}
          >
            {t("calendar.next")} →
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="border-destructive/20 bg-destructive/5 rounded-xl border px-4 py-3">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-7"
        data-testid="calendar-grid"
      >
        {days.map((day) => (
          <div
            key={day}
            className="bg-card min-h-28 rounded-xl border p-2.5 shadow-sm"
            data-day={day}
            data-weekday={weekdayOf(day)}
          >
            <div className="mb-2 text-xs font-semibold">
              {t(`weekday.${weekdayOf(day)}`)}
              <span className="text-muted-foreground font-normal"> · {day.slice(5)}</span>
            </div>
            <div className="space-y-1">
              {(byDay[day] ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`session-${s.id}`}
                  data-status={s.status}
                  disabled={!canAct}
                  onClick={() => setSelected(s)}
                  className={`block w-full rounded-lg border px-2 py-1.5 text-start text-xs transition-opacity ${STATUS_COLOR[s.status]} ${canAct ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                >
                  <span className="font-semibold">
                    {timeInTz(s.scheduled_at_utc, tz, locale)}
                  </span>{" "}
                  {s.student_name ?? ""}
                  <span className="mt-0.5 block opacity-70">
                    {t(`status.${s.status}`)}
                  </span>
                </button>
              ))}
              {loading && (byDay[day] ?? []).length === 0 && (
                <div className="bg-muted h-8 animate-pulse rounded-lg" aria-hidden />
              )}
            </div>
          </div>
        ))}
      </div>

      {selected && canAct && (
        <SessionActions
          session={selected}
          timeZone={tz}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            void load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}
