"use client";

import { CalendarX2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgendaView } from "@/components/scheduling/calendar/agenda-view";
import {
  addMonths,
  STATUS_DOT,
  STATUS_ORDER,
  startOfMonth,
  todayInTz,
} from "@/components/scheduling/calendar/utils";
import { AlertBanner } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { ApiError, type CalendarSession, getCalendar } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The full lesson log for a single student's timetable: every session over a wide window
 * (six months back → three months ahead) read in the viewer timezone, with a status summary
 * on top and the chronological agenda below. Selecting a row hands the session back so the
 * caller can open the reschedule / cancel / attendance panel.
 */
export function TimetableLogModal({
  studentId,
  studentName,
  tz,
  canAct,
  onClose,
  onSelectSession,
}: {
  studentId: string;
  studentName: string;
  tz: string;
  canAct: boolean;
  onClose: () => void;
  onSelectSession: (s: CalendarSession) => void;
}) {
  const t = useTranslations("scheduling");
  const today = todayInTz(tz);
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = startOfMonth(addMonths(today, -6));
      const to = startOfMonth(addMonths(today, 4)); // exclusive-ish upper edge; covers +3 months
      const res = await getCalendar({ from, to, studentId });
      setSessions(res.sessions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [studentId, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        status,
        n: sessions.filter((s) => s.status === status).length,
      })).filter((c) => c.n > 0),
    [sessions],
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={t("timetables.logTitle")}
      description={t("timetables.logSubtitle", { name: studentName })}
      size="lg"
    >
      <div className="space-y-4">
        {error && (
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        )}

        {/* Summary strip */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-4 py-3">
          <span className="text-sm font-semibold tabular-nums">
            {t("timetables.totalLessons", { count: sessions.length })}
          </span>
          <span className="text-muted-foreground text-xs">· {t("timetables.logRange")}</span>
          {counts.length > 0 && (
            <div className="ms-auto flex flex-wrap gap-2">
              {counts.map((c) => (
                <span
                  key={c.status}
                  className="text-muted-foreground inline-flex items-center gap-1.5 text-xs tabular-nums"
                >
                  <span className={cn("size-2 rounded-full", STATUS_DOT[c.status])} />
                  {c.n} {t(`status.${c.status}`)}
                </span>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border bg-card py-16">
            <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-card flex flex-col items-center justify-center gap-2 rounded-2xl border py-16 text-center shadow-sm">
            <CalendarX2 className="text-muted-foreground/60 size-8" aria-hidden />
            <p className="text-muted-foreground text-sm">{t("calendar.noSessions")}</p>
          </div>
        ) : (
          <AgendaView
            sessions={sessions}
            tz={tz}
            today={today}
            onSelect={(s) => canAct && onSelectSession(s)}
          />
        )}
      </div>
    </Modal>
  );
}
