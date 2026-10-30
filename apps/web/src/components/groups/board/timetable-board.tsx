"use client";

import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Clock, Download, Ellipsis, MapPin, MoveRight } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AttendanceSheet } from "@/components/groups/attendance-sheet";
import { apiErrorMessage } from "@/components/groups/group-form";
import { LESSON_TONE, fieldClass, localDateTime, needsMarking, todayIn, wallTime } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { exportRowsToExcel } from "@/lib/export-excel";
import {
  addGroupLesson,
  listBoardLessons,
  listGroups,
  rescheduleGroupLesson,
  updateGroup,
  type BoardLesson,
  type GroupRow,
  type SchedulingWarning,
} from "@/lib/groups-api";
import { cn } from "@/lib/utils";

/** A centre's week opens on Saturday, the way its own sheet is laid out. */
const WEEK_STARTS = 6;

type TimetableModal =
  | { kind: "closed" }
  | { kind: "sheet"; lesson: BoardLesson }
  | { kind: "move"; lesson: BoardLesson }
  | { kind: "room"; lesson: BoardLesson }
  | { kind: "add" };

/** One lesson as the timetable reads it: its own wall-clock day, hour and end, in its group's zone. */
export interface TimetableRow {
  lesson: BoardLesson;
  date: string;
  start: string;
  end: string;
  /** "16" — the hour block it sits under (a 16:30 class is still a four o'clock class). */
  hour: string;
  room: string;
  subject: string;
  teacher: string;
}

function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekStartOf(ymd: string): string {
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return shiftDate(ymd, -((day - WEEK_STARTS + 7) % 7));
}

function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

function roomKey(room: string): string {
  return room.trim().toLowerCase();
}

export function toTimetableRow(l: BoardLesson): TimetableRow {
  const start = localDateTime(l.scheduled_at_utc, l.group.timezone);
  const endIso = new Date(new Date(l.scheduled_at_utc).getTime() + l.duration_minutes * 60_000).toISOString();
  return {
    lesson: l,
    date: start.date,
    start: start.time,
    end: localDateTime(endIso, l.group.timezone).time,
    hour: start.time.slice(0, 2),
    room: l.group.location?.trim() ?? "",
    subject: l.group.specialization_name ?? "",
    teacher: l.teacher_name ?? "",
  };
}

/**
 * The lessons that share a room with another group at an overlapping time on the same day —
 * a centre's commonest timetable mistake, flagged red on the row. Cancelled lessons free the room.
 */
export function roomClashes(rows: TimetableRow[]): Set<string> {
  const out = new Set<string>();
  const live = rows.filter((r) => r.room !== "" && r.lesson.status !== "CANCELLED");
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (a.date !== b.date || a.lesson.group.id === b.lesson.group.id || roomKey(a.room) !== roomKey(b.room)) continue;
      const aStart = new Date(a.lesson.scheduled_at_utc).getTime();
      const bStart = new Date(b.lesson.scheduled_at_utc).getTime();
      if (aStart < bStart + b.lesson.duration_minutes * 60_000 && bStart < aStart + a.lesson.duration_minutes * 60_000) {
        out.add(a.lesson.id);
        out.add(b.lesson.id);
      }
    }
  }
  return out;
}

/**
 * The centre's timetable (the paper sheet it ran on): a week of group lessons, one day at a time
 * or the whole week, every day split into hour blocks — all the four o'clock classes together,
 * then five — each row its group, subject, teacher, room and head count. Narrow it to an hour, a
 * group, a teacher, a room or a subject; move a lesson once or its weekly time for good; add a
 * lesson; set a group's room. Two groups booked into one room at once show red.
 */
export function TimetableBoard() {
  const t = useTranslations("groups");
  const locale = useLocale();
  const { can } = useAuth();
  const canMark = can("session.mark_attendance");
  const canManage = can("group.manage");
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayIn(browserTz);

  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  // An index into the week (0 = Saturday), or the whole week.
  const [day, setDay] = useState<number | "all">(() => (weekdayOf(today) - WEEK_STARTS + 7) % 7);
  const [lessons, setLessons] = useState<BoardLesson[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    variant: "success" | "info";
    message: string;
  } | null>(null);
  const [modal, setModal] = useState<TimetableModal>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({
    hour: "",
    group: "",
    teacher: "",
    room: "",
    subject: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listBoardLessons({ view: "week", date: weekStart });
      setLessons(res.lessons);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("board.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [weekStart, t]);

  const loadGroups = useCallback(() => {
    void listGroups({ state: "ACTIVE" })
      .then((res) => setGroups(res.groups))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(loadGroups, [loadGroups]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i)), [weekStart]);
  const rows = useMemo(() => lessons.map(toTimetableRow), [lessons]);
  const clashes = useMemo(() => roomClashes(rows), [rows]);

  const options = useMemo(() => {
    const uniq = (values: string[]) => [...new Set(values.filter((v) => v !== ""))].sort((a, b) => a.localeCompare(b, locale));
    return {
      hours: [...new Set(rows.map((r) => r.hour))].sort(),
      groups: [...new Map(rows.map((r) => [r.lesson.group.id, r.lesson.group.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], locale)),
      teachers: uniq(rows.map((r) => r.teacher)),
      rooms: uniq(rows.map((r) => r.room)),
      subjects: uniq(rows.map((r) => r.subject)),
    };
  }, [rows, locale]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!filters.hour || r.hour === filters.hour) &&
          (!filters.group || r.lesson.group.id === filters.group) &&
          (!filters.teacher || r.teacher === filters.teacher) &&
          (!filters.room || roomKey(r.room) === roomKey(filters.room)) &&
          (!filters.subject || r.subject === filters.subject),
      ),
    [rows, filters],
  );

  const shownDays = day === "all" ? days : [days[day]!];
  const visible = filtered.filter((r) => shownDays.includes(r.date));
  const filtering = Object.values(filters).some((v) => v !== "");
  const clashCount = visible.filter((r) => clashes.has(r.lesson.id)).length;

  const dayName = (ymd: string, style: "long" | "short" = "long") =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: style }).format(new Date(`${ymd}T12:00:00Z`));
  const dayDate = (ymd: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    }).format(new Date(`${ymd}T12:00:00Z`));

  function finish(message: string, warnings: SchedulingWarning[] = []) {
    setModal({ kind: "closed" });
    setNotice(
      warnings.length > 0
        ? {
            variant: "info",
            message: `${message} ${warnings.map((w) => w.message).join(" · ")}`,
          }
        : { variant: "success", message },
    );
    void load();
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(apiErrorMessage(err, t("lessons.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function exportWeek() {
    await exportRowsToExcel({
      fileName: `${t("board.timetable.exportFile")} ${shownDays[0]}`,
      sheetName: t("board.timetable.exportFile"),
      rightToLeft: locale === "ar",
      rows: [...visible].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
      columns: [
        {
          header: t("board.timetable.col.day"),
          value: (r) => dayName(r.date),
          width: 12,
        },
        {
          header: t("board.timetable.col.date"),
          value: (r) => r.date,
          width: 12,
        },
        {
          header: t("board.timetable.col.time"),
          value: (r) => `${r.start} - ${r.end}`,
          width: 14,
        },
        {
          header: t("board.timetable.col.subject"),
          value: (r) => r.subject,
          width: 16,
        },
        {
          header: t("board.timetable.col.teacher"),
          value: (r) => r.teacher,
          width: 18,
        },
        {
          header: t("board.timetable.col.room"),
          value: (r) => r.room,
          width: 10,
        },
        {
          header: t("board.timetable.col.students"),
          value: (r) => r.lesson.counts?.expected ?? null,
          width: 8,
        },
        {
          header: t("board.timetable.col.group"),
          value: (r) => r.lesson.group.name,
          width: 26,
        },
        {
          header: t("board.timetable.col.status"),
          value: (r) => t(`lessonStatus.${r.lesson.status}`),
          width: 12,
        },
      ],
    });
  }

  const filterSelect = (key: keyof typeof filters, all: string, values: [string, string][], label: string) => (
    <select
      className={fieldClass}
      value={filters[key]}
      onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
      aria-label={label}
      data-testid={`timetable-filter-${key}`}
    >
      <option value="">{all}</option>
      {values.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4" data-testid="timetable">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("board.lessons.prev")} onClick={() => setWeekStart((d) => shiftDate(d, -7))}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium tabular-nums">
            {dayDate(days[0]!)} – {dayDate(days[6]!)}
          </span>
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("board.lessons.next")} onClick={() => setWeekStart((d) => shiftDate(d, 7))}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
          {weekStart !== weekStartOf(today) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setWeekStart(weekStartOf(today));
                setDay((weekdayOf(today) - WEEK_STARTS + 7) % 7);
              }}
            >
              {t("board.timetable.thisWeek")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void exportWeek()} disabled={visible.length === 0}>
            <Download className="size-4" />
            {t("board.timetable.export")}
          </Button>
          {canManage && (
            <Button type="button" size="sm" className="gap-1.5" onClick={() => setModal({ kind: "add" })} data-testid="timetable-add">
              <CalendarPlus className="size-4" />
              {t("board.timetable.add")}
            </Button>
          )}
        </div>
      </div>

      <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist">
        {days.map((d, i) => {
          const count = filtered.filter((r) => r.date === d).length;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={day === i}
              onClick={() => setDay(i)}
              className={cn(
                "shrink-0 rounded-xl border px-3 py-1.5 text-start text-sm transition-colors",
                day === i ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                d === today && day !== i && "border-primary/50",
              )}
              data-testid={`timetable-day-${d}`}
            >
              <span className="block font-medium">{dayName(d)}</span>
              <span className={cn("block text-xs tabular-nums", day === i ? "opacity-80" : "text-muted-foreground")}>
                {dayDate(d)} · {count}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={day === "all"}
          onClick={() => setDay("all")}
          className={cn(
            "shrink-0 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors",
            day === "all" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
          data-testid="timetable-day-all"
        >
          {t("board.timetable.allWeek")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {filterSelect(
          "hour",
          t("board.timetable.filters.allHours"),
          options.hours.map((h) => [h, wallTime(`${h}:00`, locale)]),
          t("board.timetable.col.time"),
        )}
        {filterSelect("group", t("board.filters.allGroups"), options.groups, t("board.filters.group"))}
        {filterSelect(
          "teacher",
          t("allTeachers"),
          options.teachers.map((v) => [v, v]),
          t("board.filters.teacher"),
        )}
        {filterSelect(
          "room",
          t("board.timetable.filters.allRooms"),
          options.rooms.map((v) => [v, v]),
          t("board.timetable.col.room"),
        )}
        {filterSelect(
          "subject",
          t("board.timetable.filters.allSubjects"),
          options.subjects.map((v) => [v, v]),
          t("board.timetable.col.subject"),
        )}
        {filtering && (
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setFilters({
                hour: "",
                group: "",
                teacher: "",
                room: "",
                subject: "",
              })
            }
          >
            {t("board.timetable.filters.clear")}
          </Button>
        )}
      </div>

      {notice && <AlertBanner variant={notice.variant} message={notice.message} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} />}
      {clashCount > 0 && <AlertBanner variant="error" message={t("board.timetable.clashBanner", { count: clashCount })} />}

      {loading && lessons.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>
      ) : visible.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">
          {filtering ? t("board.timetable.emptyFiltered") : t("board.timetable.empty")}
        </div>
      ) : (
        <div className="space-y-6">
          {shownDays.map((d) => {
            const ofDay = visible.filter((r) => r.date === d);
            if (ofDay.length === 0) return null;
            const hours = [...new Set(ofDay.map((r) => r.hour))].sort();
            return (
              <section key={d} className="space-y-3">
                {day === "all" && (
                  <h3 className="text-base font-semibold">
                    {dayName(d)} <span className="text-muted-foreground text-sm font-normal">{dayDate(d)}</span>
                  </h3>
                )}
                {hours.map((h) => {
                  const block = ofDay
                    .filter((r) => r.hour === h)
                    .sort((a, b) => a.start.localeCompare(b.start) || a.lesson.group.name.localeCompare(b.lesson.group.name, locale));
                  return (
                    <div key={h} className="overflow-hidden rounded-xl border" data-testid={`timetable-hour-${d}-${h}`}>
                      <div className="bg-muted/50 flex items-center justify-between border-b px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                          <Clock className="size-4" aria-hidden />
                          {wallTime(`${h}:00`, locale)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t("board.timetable.hourCount", {
                            count: block.length,
                          })}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[46rem] text-sm">
                          <thead className="text-muted-foreground text-xs">
                            <tr className="border-b">
                              <th className="px-3 py-2 text-start font-medium">{t("board.timetable.col.time")}</th>
                              <th className="px-3 py-2 text-start font-medium">{t("board.timetable.col.group")}</th>
                              <th className="px-3 py-2 text-start font-medium">{t("board.timetable.col.subject")}</th>
                              <th className="px-3 py-2 text-start font-medium">{t("board.timetable.col.teacher")}</th>
                              <th className="px-3 py-2 text-start font-medium">{t("board.timetable.col.room")}</th>
                              <th className="px-3 py-2 text-start font-medium">{t("board.timetable.col.students")}</th>
                              <th className="px-3 py-2 text-start font-medium">{t("board.timetable.col.status")}</th>
                              <th className="px-3 py-2" />
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {block.map((r) => (
                              <TimetableRowView
                                key={r.lesson.id}
                                row={r}
                                clash={clashes.has(r.lesson.id)}
                                canMark={canMark}
                                canManage={canManage}
                                onSheet={() => setModal({ kind: "sheet", lesson: r.lesson })}
                                onMove={() => setModal({ kind: "move", lesson: r.lesson })}
                                onRoom={() => setModal({ kind: "room", lesson: r.lesson })}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      <Modal open={modal.kind === "sheet"} onClose={() => setModal({ kind: "closed" })} title={t("sheet.title")} size="lg">
        {modal.kind === "sheet" && (
          <AttendanceSheet lessonId={modal.lesson.id} onCancel={() => setModal({ kind: "closed" })} onSaved={() => finish(t("sheet.saved"))} />
        )}
      </Modal>

      <Modal open={modal.kind === "move"} onClose={() => setModal({ kind: "closed" })} title={t("board.timetable.moveTitle")}>
        {modal.kind === "move" && (
          <MoveForm
            lesson={modal.lesson}
            group={groups.find((g) => g.id === modal.lesson.group.id)}
            busy={busy}
            onCancel={() => setModal({ kind: "closed" })}
            onOnce={(v) =>
              run(async () => {
                const res = await rescheduleGroupLesson(modal.lesson.id, v);
                finish(t("lessons.movedNotice"), res.warnings);
              })
            }
            onWeekly={(group, slots) =>
              run(async () => {
                await updateGroup(group.id, { slots });
                loadGroups();
                finish(t("board.timetable.movedWeekly"));
              })
            }
          />
        )}
      </Modal>

      <Modal
        open={modal.kind === "room"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("board.timetable.roomTitle")}
        description={t("board.timetable.roomHint")}
      >
        {modal.kind === "room" && (
          <RoomForm
            initial={modal.lesson.group.location ?? ""}
            busy={busy}
            onCancel={() => setModal({ kind: "closed" })}
            onSubmit={(room) =>
              run(async () => {
                await updateGroup(modal.lesson.group.id, {
                  mode: "OFFLINE",
                  location: room,
                });
                finish(t("board.timetable.roomSaved"));
              })
            }
          />
        )}
      </Modal>

      <Modal open={modal.kind === "add"} onClose={() => setModal({ kind: "closed" })} title={t("board.timetable.add")} description={t("lessons.extraHint")}>
        {modal.kind === "add" && (
          <AddForm
            groups={groups.filter((g) => g.status === "ACTIVE")}
            initialDate={day === "all" ? (days.includes(today) ? today : days[0]!) : days[day]!}
            busy={busy}
            onCancel={() => setModal({ kind: "closed" })}
            onSubmit={(groupId, v) =>
              run(async () => {
                const res = await addGroupLesson(groupId, v);
                finish(t("lessons.extraAdded"), res.warnings);
              })
            }
          />
        )}
      </Modal>
    </div>
  );
}

function TimetableRowView({
  row,
  clash,
  canMark,
  canManage,
  onSheet,
  onMove,
  onRoom,
}: {
  row: TimetableRow;
  clash: boolean;
  canMark: boolean;
  canManage: boolean;
  onSheet: () => void;
  onMove: () => void;
  onRoom: () => void;
}) {
  const t = useTranslations("groups");
  const l = row.lesson;
  const overdue = needsMarking(l);
  const c = l.counts;

  return (
    <tr className={cn(overdue && "bg-rose-500/[0.04]", l.status === "CANCELLED" && "opacity-60")} data-testid={`timetable-row-${l.id}`}>
      <td className="px-3 py-2 font-medium whitespace-nowrap tabular-nums" dir="ltr">
        {row.start} – {row.end}
      </td>
      <td className="px-3 py-2">
        <Link href={`/groups/${l.group.id}`} className="font-medium hover:underline">
          {l.group.name}
        </Link>
        {l.group.level && <span className="text-muted-foreground block text-xs">{l.group.level}</span>}
        {(l.extra || l.moved) && <span className="text-muted-foreground block text-xs">{l.extra ? t("lessons.extra") : t("lessons.moved")}</span>}
      </td>
      <td className="px-3 py-2">{row.subject || "—"}</td>
      <td className="px-3 py-2">{row.teacher || "—"}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={cn("inline-flex items-center gap-1", clash && "font-semibold text-rose-700 dark:text-rose-300")}>
          {clash ? <AlertTriangle className="size-3.5" aria-hidden /> : <MapPin className="text-muted-foreground size-3.5" aria-hidden />}
          {row.room || "—"}
        </span>
        {clash && (
          <span className="block text-xs text-rose-700 dark:text-rose-300" data-testid={`timetable-clash-${l.id}`}>
            {t("board.timetable.clash")}
          </span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums">{c ? (l.status === "HELD" ? `${c.present + c.late} / ${c.expected}` : c.expected) : "—"}</td>
      <td className="px-3 py-2">
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", overdue ? LESSON_TONE.OVERDUE : LESSON_TONE[l.status])}>
          {overdue ? t("lessonStatus.OVERDUE") : t(`lessonStatus.${l.status}`)}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          {canMark && l.status !== "CANCELLED" && (
            <Button type="button" size="sm" variant={l.status === "HELD" ? "outline" : "default"} onClick={onSheet}>
              {l.status === "HELD" ? t("lessons.editSheet") : t("lessons.takeAttendance")}
            </Button>
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <button
                  type="button"
                  aria-label={t("lessons.more")}
                  className="hover:bg-muted inline-flex size-8 items-center justify-center rounded-lg"
                  data-testid={`timetable-menu-${l.id}`}
                >
                  <Ellipsis className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {l.status === "SCHEDULED" && (
                  <DropdownMenuItem onClick={onMove}>
                    <MoveRight className="size-4 rtl:rotate-180" />
                    {t("board.timetable.move")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onRoom}>
                  <MapPin className="size-4" />
                  {t("board.timetable.setRoom")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Move a lesson: this one only (it is stamped moved, the weekly time stays), or its weekly time
 * for good — the group's slot is rewritten and every untouched lesson from now follows it.
 */
function MoveForm({
  lesson,
  group,
  busy,
  onCancel,
  onOnce,
  onWeekly,
}: {
  lesson: BoardLesson;
  group: GroupRow | undefined;
  busy: boolean;
  onCancel: () => void;
  onOnce: (v: { local_datetime: string; duration_minutes: number }) => void;
  onWeekly: (group: GroupRow, slots: GroupRow["slots"]) => void;
}) {
  const t = useTranslations("groups");
  const locale = useLocale();
  const start = localDateTime(lesson.scheduled_at_utc, lesson.group.timezone);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [duration, setDuration] = useState(String(lesson.duration_minutes));
  const slot = lesson.slot ?? null;
  // Only a lesson still on its weekly time can carry that time with it.
  const canWeekly = slot !== null && !lesson.moved && group !== undefined;
  const [scope, setScope] = useState<"once" | "weekly">("once");

  const minutes = Number(duration);
  const valid = date !== "" && time !== "" && minutes >= 1 && minutes <= 600;
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
  }).format(new Date(`${date || start.date}T12:00:00Z`));

  function submit() {
    if (scope === "weekly" && slot !== null && group !== undefined) {
      const newWeekday = weekdayOf(date);
      const slots = group.slots.map((s) =>
        s.weekday === slot.weekday && s.start_time_local.slice(0, 5) === slot.start_time_local
          ? {
              weekday: newWeekday,
              start_time_local: time,
              duration_minutes: minutes,
            }
          : s,
      );
      onWeekly(group, slots);
      return;
    }
    onOnce({ local_datetime: `${date} ${time}`, duration_minutes: minutes });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{lesson.group.name}</p>
      {canWeekly && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("board.timetable.move")}>
          {(["once", "weekly"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scope === s}
              onClick={() => setScope(s)}
              className={cn(
                "rounded-xl border px-3 py-2 text-start text-sm font-medium transition-colors",
                scope === s ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
              )}
              data-testid={`timetable-scope-${s}`}
            >
              {t(`board.timetable.scope.${s}`)}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{scope === "weekly" ? t("board.timetable.col.day") : t("lessons.date")}</span>
          <input className={fieldClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("lessons.time")}</span>
          <input className={fieldClass} type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="timetable-move-time" />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("lessons.duration")}</span>
          <input className={fieldClass} type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
      </div>
      {scope === "weekly" && valid && (
        <p className="text-muted-foreground text-xs">
          {t("board.timetable.weeklyHint", {
            day: weekday,
            time: wallTime(time, locale),
          })}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" disabled={busy || !valid} onClick={submit} data-testid="timetable-move-save">
          {t("lessons.moveConfirm")}
        </Button>
      </div>
    </div>
  );
}

function RoomForm({ initial, busy, onCancel, onSubmit }: { initial: string; busy: boolean; onCancel: () => void; onSubmit: (room: string | null) => void }) {
  const t = useTranslations("groups");
  const [room, setRoom] = useState(initial);

  return (
    <div className="space-y-4">
      <input
        className={fieldClass}
        value={room}
        maxLength={200}
        onChange={(e) => setRoom(e.target.value)}
        placeholder={t("form.locationPlaceholder")}
        aria-label={t("board.timetable.col.room")}
        autoFocus
      />
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" disabled={busy} onClick={() => onSubmit(room.trim() || null)}>
          {t("board.timetable.saveRoom")}
        </Button>
      </div>
    </div>
  );
}

function AddForm({
  groups,
  initialDate,
  busy,
  onCancel,
  onSubmit,
}: {
  groups: GroupRow[];
  initialDate: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (groupId: string, v: { local_datetime: string; duration_minutes: number }) => void;
}) {
  const t = useTranslations("groups");
  const [groupId, setGroupId] = useState("");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState("16:00");
  const [duration, setDuration] = useState("60");

  function pick(id: string) {
    setGroupId(id);
    const first = groups.find((g) => g.id === id)?.slots[0];
    if (first) {
      setTime(first.start_time_local.slice(0, 5));
      setDuration(String(first.duration_minutes));
    }
  }

  const minutes = Number(duration);
  const valid = groupId !== "" && date !== "" && time !== "" && minutes >= 1 && minutes <= 600;

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("board.filters.group")}</span>
        <select className={fieldClass} value={groupId} onChange={(e) => pick(e.target.value)} data-testid="timetable-add-group">
          <option value="">{t("board.timetable.pickGroup")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("lessons.date")}</span>
          <input className={fieldClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("lessons.time")}</span>
          <input className={fieldClass} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("lessons.duration")}</span>
          <input className={fieldClass} type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button
          type="button"
          disabled={busy || !valid}
          onClick={() =>
            onSubmit(groupId, {
              local_datetime: `${date} ${time}`,
              duration_minutes: minutes,
            })
          }
          data-testid="timetable-add-save"
        >
          {t("lessons.addExtraConfirm")}
        </Button>
      </div>
    </div>
  );
}
