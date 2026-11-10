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
import { ApiError, type CalendarSession, getCalendar, getLessonPackage, listLessonPackages } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The full lesson log for a single student's timetable: every session over a wide window
 * (six months back → three months ahead) read in the viewer timezone, with a status summary
 * on top and the chronological agenda below. Selecting a row hands the session back so the
 * caller can open the reschedule / cancel / attendance panel.
 *
 * A student on an open package opens on THAT package's lessons (EnglishSpirit, 2026-11-10: a block
 * of 16 showed 22, because the timetable runs on past the block's end): the lessons already counted
 * on it, then the upcoming ones its balance still covers. "All lessons" shows the whole log.
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
  // The open package's lessons, by id (null = no open package: the log is the whole timetable).
  const [packageIds, setPackageIds] = useState<Set<string> | null>(null);
  const [view, setView] = useState<"package" | "all">("package");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = startOfMonth(addMonths(today, -6));
      const to = startOfMonth(addMonths(today, 4)); // exclusive-ish upper edge; covers +3 months
      const res = await getCalendar({ from, to, studentId });
      setSessions(res.sessions);
      setPackageIds(can("package.read") ? await packageLessonIds(studentId, res.sessions) : null);
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
    () => (packageIds !== null && view === "package" ? sessions.filter((s) => packageIds.has(s.id)) : sessions),
    [sessions, packageIds, view],
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

        {/* A package student: this package's lessons, or the whole timetable. */}
        {packageIds !== null && (
          <div role="tablist" className="bg-muted/40 inline-flex rounded-xl p-1" data-testid="log-view">
            {(["package", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors",
                  view === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`log-view-${key}`}
              >
                {key === "package"
                  ? t("timetables.packageLessons", { count: sessions.filter((s) => packageIds.has(s.id)).length })
                  : t("timetables.allLessons", { count: sessions.length })}
              </button>
            ))}
          </div>
        )}

        {/* Summary strip */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-4 py-3">
          <span className="text-sm font-semibold tabular-nums">
            {t("timetables.totalLessons", { count: shown.length })}
          </span>
          {!(packageIds !== null && view === "package") && (
            <span className="text-muted-foreground text-xs">· {t("timetables.logRange")}</span>
          )}
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
 * The lessons of the student's open package(s), as session ids: each one already counted on it, then
 * — in time order — as many upcoming lessons as its balance still covers (`upcoming_in_package_count`,
 * the server's count: a lesson never splits). A block tied to a subject only takes that teacher's
 * lessons. null when nothing is open, or the packages could not be read: the log stays whole.
 */
async function packageLessonIds(studentId: string, sessions: CalendarSession[]): Promise<Set<string> | null> {
  try {
    const { packages } = await listLessonPackages({ student_id: studentId, status: "ACTIVE" });
    const open = packages.filter((p) => p.status === "ACTIVE");
    if (open.length === 0) return null;
    const ids = new Set<string>();
    const now = Date.now();
    const upcoming = sessions
      .filter((s) => !s.trial && !s.group && (s.status === "SCHEDULED" || s.status === "RESCHEDULED") && Date.parse(s.scheduled_at_utc) >= now)
      .sort((a, b) => Date.parse(a.scheduled_at_utc) - Date.parse(b.scheduled_at_utc));
    for (const row of open) {
      const { credits } = await getLessonPackage(row.id);
      for (const c of credits) if (c.session_id) ids.add(c.session_id);
      const mine = row.subject ? upcoming.filter((s) => s.teacher_id === row.subject?.teacher_id) : upcoming;
      for (const s of mine.filter((s) => !ids.has(s.id)).slice(0, row.upcoming_in_package_count ?? mine.length)) ids.add(s.id);
    }
    return ids;
  } catch {
    return null;
  }
}
