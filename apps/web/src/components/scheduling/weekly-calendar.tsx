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
  SCHEDULED: "border-blue-300 bg-blue-50 text-blue-900",
  ATTENDED: "border-emerald-300 bg-emerald-50 text-emerald-900",
  ABSENT_UNEXCUSED: "border-amber-300 bg-amber-50 text-amber-900",
  ABSENT_EXCUSED: "border-slate-300 bg-slate-50 text-slate-900",
  CANCELLED_BY_TEACHER: "border-red-300 bg-red-50 text-red-900",
  CANCELLED_BY_STUDENT: "border-red-300 bg-red-50 text-red-900",
  RESCHEDULED: "border-purple-300 bg-purple-50 text-purple-900",
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
        <h1 className="text-2xl font-semibold">{t("calendar.title")}</h1>
        <div className="flex items-center gap-2">
          {canPickTeacher && (
            <select
              aria-label={t("calendar.teacher")}
              data-testid="calendar-teacher"
              className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
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
          <span className="text-sm" data-testid="week-range">
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
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-7"
        data-testid="calendar-grid"
      >
        {days.map((day) => (
          <div
            key={day}
            className="min-h-24 rounded-md border p-2"
            data-day={day}
            data-weekday={weekdayOf(day)}
          >
            <div className="mb-1 text-xs font-medium">
              {t(`weekday.${weekdayOf(day)}`)}
              <span className="text-muted-foreground"> · {day.slice(5)}</span>
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
                  className={`block w-full rounded border px-1.5 py-1 text-start text-xs ${STATUS_COLOR[s.status]} ${canAct ? "cursor-pointer" : "cursor-default"}`}
                >
                  <span className="font-medium">
                    {timeInTz(s.scheduled_at_utc, tz, locale)}
                  </span>{" "}
                  {s.student_name ?? ""}
                  <span className="block opacity-75">
                    {t(`status.${s.status}`)}
                  </span>
                </button>
              ))}
              {loading && (byDay[day] ?? []).length === 0 && (
                <span className="text-muted-foreground text-xs">…</span>
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
