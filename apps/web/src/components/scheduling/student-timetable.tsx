"use client";

import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AgendaView } from "@/components/scheduling/calendar/agenda-view";
import {
  addDays,
  addMonths,
  monthYearLabel,
  startOfMonth,
  todayInTz,
} from "@/components/scheduling/calendar/utils";
import { ScheduleSection } from "@/components/scheduling/schedule-editor";
import { SessionActions } from "@/components/scheduling/session-actions";
import { AttendanceReportModal } from "@/components/attendance/attendance-report-modal";
import { ScheduleTrialModal } from "@/components/students/schedule-trial-modal";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { getCalendar, type CalendarSession } from "@/lib/api";

/**
 * The premium per-student timetable: the recurring weekly schedule editor on top, then a
 * month-scoped feed of this student's concrete sessions. Selecting a session opens the
 * reschedule / cancel / attendance panel; the toolbar can also book a one-off trial. Every
 * mutation re-fetches the month so the feed never drifts from the server.
 */
export function StudentTimetable({
  studentId,
  studentName,
  studentStatus,
  canManage,
  onError,
}: {
  studentId: string;
  studentName: string;
  studentStatus?: string | null;
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const { can } = useAuth();

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInTz(tz);
  const [anchor, setAnchor] = useState(() => startOfMonth(today));
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [selected, setSelected] = useState<CalendarSession | null>(null);
  const [trialOpen, setTrialOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    const from = startOfMonth(anchor);
    const to = addDays(addMonths(from, 1), -1);
    try {
      const res = await getCalendar({ from, to, studentId });
      setSessions(res.sessions);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [anchor, studentId, onError]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return (
    <div className="space-y-6">
      {/* Recurring weekly schedule editor */}
      <ScheduleSection
        studentId={studentId}
        canManage={canManage}
        onError={onError}
        onChanged={() => void loadSessions()}
      />

      {/* Sessions calendar */}
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-sm">
          <div className="flex size-9 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
            <CalendarRange className="size-4 text-violet-500" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("timetable.sessionsTitle")}</h3>
            <p className="text-muted-foreground text-xs">
              {t("timetable.sessionsSubtitle")}
            </p>
          </div>

          <div className="ms-auto flex items-center gap-1.5">
            {/* Month nav */}
            <div className="flex items-center gap-1 rounded-xl border bg-muted/30 p-1">
              <button
                type="button"
                aria-label={t("calendar.prev")}
                onClick={() => setAnchor((a) => addMonths(a, -1))}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
              </button>
              <span className="min-w-32 px-2 text-center text-sm font-semibold tabular-nums">
                {monthYearLabel(anchor, locale)}
              </span>
              <button
                type="button"
                aria-label={t("calendar.next")}
                onClick={() => setAnchor((a) => addMonths(a, 1))}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAnchor(startOfMonth(today))}
            >
              {t("calendar.today")}
            </Button>
            {/* Hide "schedule trial" once a trial is already booked (status TRIAL_BOOKED). */}
            {canManage && studentStatus !== "TRIAL_BOOKED" && (
              <Button
                type="button"
                size="sm"
                onClick={() => setTrialOpen(true)}
                className="gap-1.5 border-transparent bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500/40"
              >
                <Sparkles className="size-3.5" />
                {t("timetable.scheduleTrial")}
              </Button>
            )}
          </div>
        </div>

        {/* Agenda feed */}
        <AgendaView
          sessions={sessions}
          tz={tz}
          today={today}
          onSelect={setSelected}
        />
      </div>

      {/* A not-yet-marked session (SCHEDULED): reschedule / cancel / open attendance. These
          actions only make sense before an outcome is recorded. */}
      {selected && selected.status === "SCHEDULED" && (
        <Modal
          open
          onClose={() => setSelected(null)}
          title={t("actions.title", { name: selected.student_name ?? studentName })}
          size="md"
        >
          <SessionActions
            session={selected}
            timeZone={tz}
            hideHeader
            onClose={() => setSelected(null)}
            onDone={() => {
              setSelected(null);
              void loadSessions();
            }}
            onError={onError}
          />
        </Modal>
      )}

      {/* An already-marked session: show the same attendance popup (outcome + report) but
          read-only — no reschedule/cancel, no editing, just a view of what was recorded. */}
      {selected && selected.status !== "SCHEDULED" && (
        <AttendanceReportModal
          sessionId={selected.id}
          studentName={selected.student_name ?? studentName}
          open
          onClose={() => setSelected(null)}
          readOnly
        />
      )}

      {/* Schedule a one-off trial */}
      {trialOpen && can("schedule.manage") && studentStatus !== "TRIAL_BOOKED" && (
        <ScheduleTrialModal
          open
          studentId={studentId}
          studentName={studentName}
          onClose={() => setTrialOpen(false)}
          onScheduled={() => {
            setTrialOpen(false);
            void loadSessions();
          }}
        />
      )}
    </div>
  );
}
