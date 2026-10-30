"use client";

import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, MapPin, Video } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AttendanceSheet } from "@/components/groups/attendance-sheet";
import { BoardFilters, useBoardFilterOptions } from "@/components/groups/board/board-filters";
import { TimetableBoard } from "@/components/groups/board/timetable-board";
import { apiErrorMessage } from "@/components/groups/group-form";
import { LESSON_TONE, fieldClass, lessonDate, lessonTime, needsMarking, todayIn } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { useCapability } from "@/lib/capabilities";
import { listBoardLessons, type BoardLesson } from "@/lib/groups-api";
import { cn } from "@/lib/utils";

type View = "timetable" | "day" | "week" | "owed";

function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Group lessons across every group (docs/groups §Screens) — the page the academy works from each
 * day: today's classes, the week ahead, and every sheet still owed (red, oldest first). One tap on
 * a lesson opens its attendance sheet; a saved sheet drops it off the owed list and the sidebar
 * counter.
 */
export function LessonsBoard() {
  const t = useTranslations("groups");
  const locale = useLocale();
  const { can } = useAuth();
  const canMark = can("session.mark_attendance");
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // A centre works from its weekly timetable (hour blocks, rooms); everyone else's views are unchanged.
  const centre = useCapability("centre");
  const views: View[] = centre ? ["timetable", "day", "week", "owed"] : ["day", "week", "owed"];

  const [view, setView] = useState<View>(centre ? "timetable" : "day");
  const [date, setDate] = useState(() => todayIn(browserTz));
  const [groupId, setGroupId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [lessons, setLessons] = useState<BoardLesson[]>([]);
  const [owedCount, setOwedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<BoardLesson | null>(null);
  const options = useBoardFilterOptions();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters = { group_id: groupId || undefined, teacher_id: teacherId || undefined };
      // The timetable loads its own week; here it only needs the owed counter.
      const listed = view === "timetable" ? "owed" : view;
      const [res, owed] = await Promise.all([
        listBoardLessons({ view: listed, date: listed === "owed" ? undefined : date, ...filters }),
        listed === "owed" ? null : listBoardLessons({ view: "owed", ...filters }),
      ]);
      setLessons(view === "timetable" ? [] : res.lessons);
      setOwedCount(listed === "owed" ? res.lessons.length : (owed?.lessons.length ?? 0));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("board.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [view, date, groupId, teacherId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The week view reads as one block per day.
  const byDay = useMemo(() => {
    const out = new Map<string, BoardLesson[]>();
    for (const l of lessons) {
      const day = view === "owed" ? l.occurrence_local_date : new Intl.DateTimeFormat("en-CA", { timeZone: l.group.timezone }).format(new Date(l.scheduled_at_utc));
      out.set(day, [...(out.get(day) ?? []), l]);
    }
    return [...out.entries()];
  }, [lessons, view]);

  return (
    <div className="space-y-5">
      <PageHero
        icon={ClipboardCheck}
        title={t("board.lessons.title")}
        subtitle={t("board.lessons.subtitle")}
        latticeId="groups-lessons-hero"
        actions={owedCount !== null && owedCount > 0 ? <HeroPill>{t("board.lessons.owedPill", { count: owedCount })}</HeroPill> : undefined}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist">
          {views.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                view === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                v === "owed" && view !== v && (owedCount ?? 0) > 0 && "border-rose-500/40 text-rose-700 dark:text-rose-300",
              )}
              data-testid={`lessons-view-${v}`}
            >
              {t(`board.lessons.view.${v}`)}
              {v === "owed" && (owedCount ?? 0) > 0 && <span className="ms-1.5 tabular-nums">{owedCount}</span>}
            </button>
          ))}
        </div>
        {view !== "timetable" && (
          <BoardFilters
            options={options}
            groupId={groupId}
            onGroup={setGroupId}
            teacherId={teacherId}
            onTeacher={setTeacherId}
          />
        )}
      </div>

      {view === "timetable" && <TimetableBoard />}

      {(view === "day" || view === "week") && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("board.lessons.prev")} onClick={() => setDate((d) => shiftDate(d, view === "week" ? -7 : -1))}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <input type="date" className={cn(fieldClass, "w-44")} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={t("board.lessons.date")} />
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("board.lessons.next")} onClick={() => setDate((d) => shiftDate(d, view === "week" ? 7 : 1))}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDate(todayIn(browserTz))}>
            {t("board.lessons.today")}
          </Button>
        </div>
      )}

      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} />}

      {view === "timetable" ? null : loading && lessons.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>
      ) : lessons.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <CalendarDays className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="text-muted-foreground mt-2 text-sm">{t(`board.lessons.empty.${view}`)}</p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="board-lessons">
          {byDay.map(([day, rows]) => (
            <section key={day} className="space-y-2">
              {(view !== "day") && (
                <h3 className={cn("text-sm font-semibold", view === "owed" && "text-rose-700 dark:text-rose-300")}>
                  {lessonDate(`${day}T12:00:00Z`, "UTC", locale)}
                </h3>
              )}
              <ul className={cn("divide-y overflow-hidden rounded-xl border", view === "owed" && "border-rose-500/30")}>
                {rows.map((l) => {
                  const overdue = needsMarking(l);
                  const c = l.counts;
                  return (
                    <li key={l.id} className={cn("flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between", overdue && "bg-rose-500/[0.04]")} data-testid={`board-lesson-${l.id}`}>
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="w-16 shrink-0 pt-0.5 text-sm font-semibold tabular-nums">{lessonTime(l.scheduled_at_utc, l.group.timezone, locale)}</span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <Link href={`/groups/${l.group.id}`} className="truncate font-medium hover:underline">
                              {l.group.name}
                            </Link>
                            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", overdue ? LESSON_TONE.OVERDUE : LESSON_TONE[l.status])}>
                              {overdue ? t("lessonStatus.OVERDUE") : t(`lessonStatus.${l.status}`)}
                            </span>
                            {l.extra && <span className="text-muted-foreground text-xs">{t("lessons.extra")}</span>}
                          </p>
                          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                            {l.group.level && <span>{l.group.level}</span>}
                            {l.teacher_name && <span>{l.teacher_name}</span>}
                            <span className="inline-flex items-center gap-1">
                              {l.group.mode === "ONLINE" ? <Video className="size-3" aria-hidden /> : <MapPin className="size-3" aria-hidden />}
                              {l.group.mode === "OFFLINE" && l.group.location ? l.group.location : t(`mode.${l.group.mode}`)}
                            </span>
                            <span>{t("minutes", { count: l.duration_minutes })}</span>
                            {l.status === "CANCELLED" && l.cancel_reason && <span>· {l.cancel_reason}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {c && (
                          <span className="text-sm tabular-nums">
                            {l.status === "HELD" ? (
                              <>
                                <strong className="text-emerald-600 dark:text-emerald-400">{c.present + c.late}</strong>
                                <span className="text-muted-foreground"> / {c.expected}</span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">{t("students", { count: c.expected })}</span>
                            )}
                          </span>
                        )}
                        {canMark && l.status !== "CANCELLED" && (
                          <Button
                            type="button"
                            size="sm"
                            variant={l.status === "HELD" ? "outline" : "default"}
                            className="gap-1.5"
                            onClick={() => setSheet(l)}
                            data-testid={`board-mark-${l.id}`}
                          >
                            {overdue && <AlertTriangle className="size-3.5" />}
                            {l.status === "HELD" ? t("lessons.editSheet") : t("lessons.takeAttendance")}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Modal open={sheet !== null} onClose={() => setSheet(null)} title={t("sheet.title")} size="lg">
        {sheet && (
          <AttendanceSheet
            lessonId={sheet.id}
            onCancel={() => setSheet(null)}
            onSaved={() => {
              setSheet(null);
              setNotice(t("sheet.saved"));
              void load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
