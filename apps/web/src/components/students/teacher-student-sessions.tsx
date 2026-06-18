"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
  addDays,
  addMonths,
  monthYearLabel,
  startOfMonth,
  todayInTz,
} from "@/components/scheduling/calendar/utils";
import { Button } from "@/components/ui/button";
import { getCalendar, type CalendarSession } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  ATTENDED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  ABSENT_EXCUSED: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  ABSENT_UNEXCUSED: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  CANCELLED_BY_TEACHER: "bg-slate-100 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400",
  CANCELLED_BY_STUDENT: "bg-slate-100 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400",
  RESCHEDULED: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
};

/**
 * Simple read-only session list for a teacher viewing one of their students.
 * Only shows sessions where the calling teacher is involved (enforced server-side).
 */
export function TeacherStudentSessions({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInTz(tz);

  const [anchor, setAnchor] = useState(() => startOfMonth(today));
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = startOfMonth(anchor);
      const to = addDays(addMonths(from, 1), -1);
      const res = await getCalendar({ from, to, studentId });
      setSessions(res.sessions);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [anchor, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = groupByDay(sessions, tz, locale);

  return (
    <div className="space-y-4">
      {/* Month nav */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-xl border bg-card shadow-sm">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setAnchor((a) => startOfMonth(addMonths(a, -1)))}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setAnchor((a) => startOfMonth(addMonths(a, 1)))}
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAnchor(startOfMonth(today))}
        >
          {t("calendar.today")}
        </Button>
        <span className="text-sm font-semibold">
          {monthYearLabel(anchor, locale)}
        </span>
      </div>

      {/* Sessions */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden />
          {t("timetable.emptyMonth")}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ dateLabel, items }) => (
            <div key={dateLabel}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {dateLabel}
              </p>
              <ul className="space-y-2">
                {items.map((s) => (
                  <SessionRow key={s.id} session={s} tz={tz} locale={locale} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session: s,
  tz,
  locale,
}: {
  session: CalendarSession;
  tz: string;
  locale: string;
}) {
  const t = useTranslations("scheduling");
  const dt = new Date(s.scheduled_at_utc);
  const timeStr = dt.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });

  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary tabular-nums">
        {timeStr}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{s.student_name}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3 shrink-0" aria-hidden />
          {s.duration_minutes} {t("timetable.durationUnit")}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
          STATUS_STYLES[s.status] ?? "bg-muted text-muted-foreground",
        )}
      >
        {t(`status.${s.status}`)}
      </span>
    </li>
  );
}

function groupByDay(
  sessions: CalendarSession[],
  tz: string,
  locale: string,
): { dateLabel: string; items: CalendarSession[] }[] {
  const map = new Map<string, CalendarSession[]>();
  for (const s of sessions) {
    const key = new Date(s.scheduled_at_utc).toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: tz,
    });
    const bucket = map.get(key) ?? [];
    bucket.push(s);
    map.set(key, bucket);
  }
  return Array.from(map.entries()).map(([dateLabel, items]) => ({
    dateLabel,
    items,
  }));
}
