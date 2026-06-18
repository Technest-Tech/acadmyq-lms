"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  startOfWeek,
  todayInTz,
  weekRangeLabel,
} from "@/components/scheduling/calendar/utils";
import { TimeGridView } from "@/components/scheduling/calendar/time-grid-view";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  type AvailabilityWindow,
  type CalendarSession,
  getCalendar,
} from "@/lib/api";

/**
 * A focused weekly calendar for one teacher: their scheduled sessions (status-coloured) laid
 * over soft bands marking their declared availability windows. Read-only — clicking a session
 * is a no-op here; full reschedule/attendance lives on the main calendar.
 */
export function TeacherCalendar({
  teacherId,
  availability,
  timeZone,
}: {
  teacherId: string;
  availability: AvailabilityWindow[];
  timeZone?: string;
}) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const tz =
    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const today = todayInTz(tz);
  const [anchor, setAnchor] = useState(today);
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { from, to, days, title } = useMemo(() => {
    const ws = startOfWeek(anchor);
    return {
      from: ws,
      to: addDays(ws, 6),
      days: Array.from({ length: 7 }, (_, i) => addDays(ws, i)),
      title: weekRangeLabel(ws, locale),
    };
  }, [anchor, locale]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCalendar({ from, to, teacherId });
      setSessions(res.sessions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border bg-card shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("calendar.prevWeek")}
              onClick={() => setAnchor((a) => addDays(a, -7))}
            >
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("calendar.nextWeek")}
              onClick={() => setAnchor((a) => addDays(a, 7))}
            >
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAnchor(today)}
          >
            {t("calendar.today")}
          </Button>
          <h3 className="text-sm font-semibold tabular-nums">{title}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded border border-emerald-400/30 bg-emerald-400/15" />
            {t("calendar.available")}
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {loading && sessions.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <TimeGridView
          days={days}
          sessions={sessions}
          tz={tz}
          today={today}
          availability={availability}
          onSelect={() => {}}
        />
      )}

      {!loading && sessions.length === 0 && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-6 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden />
          {t("calendar.noSessions")}
        </div>
      )}
    </div>
  );
}
