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
import { useAuth } from "@/components/auth-provider";
import { ApiError, type CalendarSession, getCalendar, listLessonPackages } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The full lesson log for a single student's timetable: every session over a wide window
 * (six months back → three months ahead) read in the viewer timezone, with a status summary
 * on top and the chronological agenda below. Selecting a row hands the session back so the
 * caller can open the reschedule / cancel / attendance panel.
 *
 * A student on an open package never sees the upcoming lessons past its end (EnglishSpirit,
 * 2026-11-10: a block of 16 showed 22, because the timetable runs on past the block's end). Every
 * academy, no setting: those lessons belong to no package yet. They come into the log as the next
 * block opens; the calendar itself still shows them.
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
  const { can } = useAuth();
  // The upcoming lessons past the open package's end, by id: left out of the log.
  const [beyond, setBeyond] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = startOfMonth(addMonths(today, -6));
      const to = startOfMonth(addMonths(today, 4)); // exclusive-ish upper edge; covers +3 months
      const res = await getCalendar({ from, to, studentId });
      setSessions(res.sessions);
      setBeyond(can("package.read") ? await lessonsPastPackage(studentId, res.sessions) : new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [studentId, today, can]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => sessions.filter((s) => !beyond.has(s.id)),
    [sessions, beyond],
  );

  const counts = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        status,
        n: shown.filter((s) => s.status === status).length,
      })).filter((c) => c.n > 0),
    [shown],
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
            {t("timetables.totalLessons", { count: shown.length })}
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
        ) : shown.length === 0 ? (
          <div className="bg-card flex flex-col items-center justify-center gap-2 rounded-2xl border py-16 text-center shadow-sm">
            <CalendarX2 className="text-muted-foreground/60 size-8" aria-hidden />
            <p className="text-muted-foreground text-sm">{t("calendar.noSessions")}</p>
          </div>
        ) : (
          <AgendaView
            sessions={shown}
            tz={tz}
            today={today}
            onSelect={(s) => canAct && onSelectSession(s)}
          />
        )}
      </div>
    </Modal>
  );
}

/**
 * The upcoming lessons past the end of the student's open package(s), as session ids. Per open block,
 * in time order, the first `upcoming_in_package_count` upcoming lessons are its own (the server's
 * count: a lesson never splits); the rest are past its end. A block tied to a subject only looks at
 * that teacher's lessons. Nothing open, or the packages could not be read: nothing is left out.
 */
async function lessonsPastPackage(studentId: string, sessions: CalendarSession[]): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { packages } = await listLessonPackages({ student_id: studentId, status: "ACTIVE" });
    const now = Date.now();
    const upcoming = sessions
      .filter((s) => !s.trial && !s.group && (s.status === "SCHEDULED" || s.status === "RESCHEDULED") && Date.parse(s.scheduled_at_utc) >= now)
      .sort((a, b) => Date.parse(a.scheduled_at_utc) - Date.parse(b.scheduled_at_utc));
    for (const row of packages.filter((p) => p.status === "ACTIVE")) {
      if (row.upcoming_in_package_count === undefined) continue;
      const mine = row.subject ? upcoming.filter((s) => s.teacher_id === row.subject?.teacher_id) : upcoming;
      for (const s of mine.slice(row.upcoming_in_package_count)) out.add(s.id);
    }
  } catch {
    return new Set();
  }
  return out;
}
