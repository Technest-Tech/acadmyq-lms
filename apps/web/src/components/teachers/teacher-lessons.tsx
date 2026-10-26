"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Loader2,
  RotateCcw,
  Trash2,
  Undo2,
  UserX,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttendanceReportModal } from "@/components/attendance/attendance-report-modal";
import { RescheduleModal } from "@/components/attendance/reschedule-modal";
import { RevertOutcomeDialog } from "@/components/attendance/revert-outcome-dialog";
import { StatusBadge } from "@/components/attendance/status-badge";
import { useAuth } from "@/components/auth-provider";
import {
  addMonths,
  monthYearLabel,
  startOfMonth,
} from "@/components/scheduling/calendar/utils";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SegmentTile } from "@/components/ui/segment-tile";
import { deleteSession, getSessionsByDay, type DaySession } from "@/lib/api";
import { cn } from "@/lib/utils";

type View = "all" | "upcoming" | "recorded" | "pending";

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** The local calendar date (Y-m-d) an instant falls on, in the browser's timezone. */
function localDay(utcIso: string): string {
  const d = new Date(utcIso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** Which of the four cuts a lesson belongs to, besides "all". */
function cutOf(s: DaySession, nowMs: number): Exclude<View, "all"> {
  if (s.status !== "SCHEDULED") return "recorded";
  return new Date(s.scheduled_at_utc).getTime() + s.duration_minutes * 60000 > nowMs
    ? "upcoming"
    : "pending";
}

/**
 * The teacher profile's Lessons tab: every lesson of one teacher, a month at a time — the ones
 * already recorded and the ones still ahead — with the attendance page's own actions on each.
 *
 * Nothing here moves money by itself. Marking, undoing, moving and deleting all go through the
 * same endpoints the attendance page uses, and the server reconciles the student's invoice and
 * the teacher's salary on each of them. This is a second door onto those actions, scoped to one
 * teacher, not a second implementation of them.
 */
export function TeacherLessons({ teacherId }: { teacherId: string }) {
  const t = useTranslations("teachers.lessons");
  const locale = useLocale();
  const { can } = useAuth();
  const canMark = can("session.mark_attendance");
  const canReschedule = can("session.reschedule");
  const canRevert = can("session.revert_attendance");
  const canDelete = can("session.delete");

  const [month, setMonth] = useState(() => startOfMonth(todayStr()));
  const [view, setView] = useState<View>("all");
  const [sessions, setSessions] = useState<DaySession[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [opened, setOpened] = useState<DaySession | null>(null);
  const [moving, setMoving] = useState<DaySession | null>(null);
  const [reverting, setReverting] = useState<DaySession | null>(null);
  const [deleting, setDeleting] = useState<DaySession | null>(null);

  // A month switch can outrun the previous month's response; only the newest one lands.
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setSessions(null);
    setError(null);
    try {
      const from = new Date(`${month}T00:00:00`).toISOString();
      const to = new Date(`${addMonths(month, 1)}T00:00:00`).toISOString();
      const res = await getSessionsByDay({ from, to, teacher_id: teacherId });
      if (seq !== reqSeq.current) return;
      setSessions(res.sessions);
      setTruncated(res.truncated ?? false);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [month, teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nowMs = Date.now();
  const counts = useMemo(() => {
    const c = { all: 0, upcoming: 0, recorded: 0, pending: 0 };
    for (const s of sessions ?? []) {
      c.all++;
      c[cutOf(s, nowMs)]++;
    }
    return c;
    // nowMs moves every render; the cuts only need recomputing when the rows do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const dayGroups = useMemo(() => {
    if (sessions === null) return null;
    const groups: { day: string; rows: DaySession[] }[] = [];
    for (const s of sessions) {
      if (view !== "all" && cutOf(s, nowMs) !== view) continue;
      const day = localDay(s.scheduled_at_utc);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.rows.push(s);
      else groups.push({ day, rows: [s] });
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, view]);

  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }),
    [locale],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const whenFmt = useMemo(
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

  const share = (n: number) => (counts.all > 0 ? Math.round((n / counts.all) * 100) : null);
  const thisMonth = startOfMonth(todayStr());

  return (
    <div className="space-y-4" data-testid="teacher-lessons">
      <div className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t("title")}</h2>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={t("prev")}
              onClick={() => setMonth((m) => addMonths(m, -1))}
            >
              <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium" data-testid="lessons-month">
              {monthYearLabel(month, locale)}
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={t("next")}
              onClick={() => setMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
            </Button>
            {month !== thisMonth && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setMonth(thisMonth)}>
                {t("thisMonth")}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SegmentTile
            testKey="all"
            icon={ClipboardList}
            label={t("all")}
            hint={t("allHint")}
            value={sessions === null ? null : counts.all}
            share={null}
            tone="slate"
            selected={view === "all"}
            onSelect={() => setView("all")}
          />
          <SegmentTile
            testKey="recorded"
            icon={CheckCircle2}
            label={t("recorded")}
            hint={t("recordedHint")}
            value={sessions === null ? null : counts.recorded}
            share={share(counts.recorded)}
            tone="emerald"
            selected={view === "recorded"}
            onSelect={() => setView(view === "recorded" ? "all" : "recorded")}
          />
          <SegmentTile
            testKey="upcoming"
            icon={CalendarClock}
            label={t("upcoming")}
            hint={t("upcomingHint")}
            value={sessions === null ? null : counts.upcoming}
            share={share(counts.upcoming)}
            tone="violet"
            selected={view === "upcoming"}
            onSelect={() => setView(view === "upcoming" ? "all" : "upcoming")}
          />
          <SegmentTile
            testKey="pending"
            icon={UserX}
            label={t("pending")}
            hint={t("pendingHint")}
            value={sessions === null ? null : counts.pending}
            share={share(counts.pending)}
            tone="gold"
            selected={view === "pending"}
            onSelect={() => setView(view === "pending" ? "all" : "pending")}
          />
        </div>
      </div>

      {error !== null && <AlertBanner variant="error" message={error} />}
      {truncated && <AlertBanner variant="info" message={t("truncated")} />}

      {dayGroups === null && error === null && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card h-16 animate-pulse rounded-xl border" />
          ))}
        </div>
      )}

      {dayGroups !== null && dayGroups.length === 0 && (
        <p className="text-muted-foreground bg-card rounded-2xl border p-8 text-center text-sm">
          {t("empty")}
        </p>
      )}

      {dayGroups?.map(({ day, rows }) => (
        <section key={day} className="bg-card overflow-hidden rounded-2xl border shadow-sm">
          <h3 className="bg-muted/40 text-muted-foreground border-b px-4 py-2 text-xs font-semibold">
            {dayFmt.format(new Date(`${day}T12:00:00`))}
          </h3>
          <ul className="divide-y">
            {rows.map((s) => {
              const recorded = s.status !== "SCHEDULED";
              return (
                <li
                  key={s.id}
                  data-testid={`lesson-row-${s.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="w-14 shrink-0 text-sm font-semibold tabular-nums" dir="ltr">
                      {timeFmt.format(new Date(s.scheduled_at_utc))}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.student_name ?? "—"}</p>
                      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" aria-hidden />
                          {t("minutes", { n: s.duration_minutes })}
                        </span>
                        {recorded && s.done_by_name && (
                          <span>{t("doneBy", { name: s.done_by_name })}</span>
                        )}
                      </p>
                    </div>
                    <StatusBadge status={s.status} className="shrink-0" />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {canReschedule && s.status === "SCHEDULED" && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        className="gap-1.5"
                        data-testid="lesson-reschedule"
                        onClick={() => setMoving(s)}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        {t("reschedule")}
                      </Button>
                    )}
                    {canRevert && recorded && s.status !== "RESCHEDULED" && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        className="gap-1.5"
                        data-testid="lesson-undo"
                        onClick={() => setReverting(s)}
                      >
                        <Undo2 className="size-3.5" aria-hidden />
                        {t("undo")}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        className="text-destructive hover:text-destructive gap-1.5"
                        data-testid="lesson-delete"
                        onClick={() => setDeleting(s)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        {t("delete")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="xs"
                      variant={!recorded && canMark ? "default" : "outline"}
                      data-testid="lesson-open"
                      onClick={() => setOpened(s)}
                    >
                      {!recorded && canMark ? t("record") : t("open")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* Mark the lesson, write its report, or correct its length — the attendance page's modal. */}
      {opened !== null && (
        <AttendanceReportModal
          sessionId={opened.id}
          studentName={opened.student_name}
          open
          onClose={() => {
            setOpened(null);
            void load();
          }}
        />
      )}

      <RescheduleModal
        session={moving}
        open={moving !== null}
        onClose={() => setMoving(null)}
        onDone={() => {
          setMoving(null);
          void load();
        }}
      />

      {reverting !== null && (
        <RevertOutcomeDialog
          sessionId={reverting.id}
          studentName={reverting.student_name}
          currentStatus={reverting.status}
          open
          onClose={() => setReverting(null)}
          onReverted={() => {
            setReverting(null);
            void load();
          }}
        />
      )}

      {deleting !== null && (
        <DeleteLessonDialog
          session={deleting}
          when={whenFmt.format(new Date(deleting.scheduled_at_utc))}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Confirm a delete. Like an undo it moves money — the invoice line and the salary line come off —
 * so it says so first. A refusal (closed invoice, finalized salary) is shown inside the dialog
 * rather than as a toast that outlives it.
 */
function DeleteLessonDialog({
  session,
  when,
  onClose,
  onDeleted,
}: {
  session: DaySession;
  when: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("teachers.lessons");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteSession(session.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={t("deleteTitle")}
      description={session.student_name ?? undefined}
      size="sm"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("deleteCancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
            data-testid="lesson-delete-confirm"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-3.5" aria-hidden />
            )}
            {t("deleteConfirm")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed">{t("deleteBody", { when })}</p>
        {session.status !== "SCHEDULED" && session.status !== "RESCHEDULED" && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("deleteMoney")}</span>
          </div>
        )}
        <p className="text-muted-foreground text-xs leading-relaxed">{t("deleteHint")}</p>
        {error !== null && (
          <p
            data-testid="lesson-delete-error"
            className={cn(
              "border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-3 text-xs leading-relaxed",
            )}
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
