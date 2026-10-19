"use client";

import {
  AlertTriangle,
  Ban,
  CalendarPlus,
  ClipboardCheck,
  Ellipsis,
  MoveRight,
  RotateCcw,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AttendanceSheet } from "@/components/groups/attendance-sheet";
import { apiErrorMessage } from "@/components/groups/group-form";
import {
  LESSON_TONE,
  fieldClass,
  lessonDate,
  lessonTime,
  localDateTime,
  needsMarking,
  todayIn,
} from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import {
  addGroupLesson,
  cancelGroupLesson,
  listGroupLessons,
  rescheduleGroupLesson,
  revertGroupLesson,
  type GroupDetail,
  type GroupLesson,
} from "@/lib/groups-api";
import { cn } from "@/lib/utils";

type ModalState =
  | { kind: "closed" }
  | { kind: "sheet"; lesson: GroupLesson }
  | { kind: "move"; lesson: GroupLesson }
  | { kind: "cancel"; lesson: GroupLesson }
  | { kind: "revert"; lesson: GroupLesson }
  | { kind: "extra" };

/** Upcoming lessons shown before "show all". */
const UPCOMING_PREVIEW = 6;

/**
 * A group's lessons, in the order the academy acts on them: the sheets still owed (red), what is
 * coming, and what already happened. One tap on a lesson opens its attendance sheet.
 */
export function GroupLessonsPanel({ group, onChanged }: { group: GroupDetail; onChanged: () => void }) {
  const t = useTranslations("groups");
  const locale = useLocale();
  const { can } = useAuth();
  const canMark = can("session.mark_attendance");
  const canManage = can("group.manage");
  const canRevert = can("session.revert_attendance");

  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listGroupLessons(group.id);
      setLessons(res.lessons);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("lessons.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [group.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const { owed, upcoming, past } = useMemo(() => {
    const now = Date.now();
    const owed = lessons.filter((l) => needsMarking(l, now));
    const upcoming = lessons.filter((l) => l.status === "SCHEDULED" && !needsMarking(l, now));
    const past = lessons.filter((l) => l.status !== "SCHEDULED").reverse();
    return { owed, upcoming, past };
  }, [lessons]);

  function done(message?: string) {
    setModal({ kind: "closed" });
    if (message) setNotice(message);
    void load();
    onChanged();
  }

  /** Run a write; the action may return a message of its own (e.g. a conflict warning). */
  async function run(action: () => Promise<string | void>, message: string) {
    setBusy(true);
    setError(null);
    try {
      const own = await action();
      done(own || message);
    } catch (err) {
      setError(apiErrorMessage(err, t("lessons.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  function renderRow(lesson: GroupLesson) {
    const overdue = needsMarking(lesson);
    const tone = overdue ? LESSON_TONE.OVERDUE : LESSON_TONE[lesson.status];
    const c = lesson.counts;
    const menu = [
      canManage && lesson.status === "SCHEDULED" && {
        key: "move",
        icon: MoveRight,
        label: t("lessons.move"),
        onClick: () => setModal({ kind: "move", lesson }),
      },
      canManage && lesson.status === "SCHEDULED" && {
        key: "cancel",
        icon: Ban,
        label: t("lessons.cancel"),
        onClick: () => setModal({ kind: "cancel", lesson }),
        danger: true,
      },
      canRevert && lesson.status !== "SCHEDULED" && {
        key: "revert",
        icon: RotateCcw,
        label: t("lessons.revert"),
        onClick: () => setModal({ kind: "revert", lesson }),
      },
    ].filter(Boolean) as { key: string; icon: typeof Ban; label: string; onClick: () => void; danger?: boolean }[];

    return (
      <li
        key={lesson.id}
        className={cn("flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between", overdue && "bg-rose-500/[0.04]")}
        data-testid={`lesson-${lesson.id}`}
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span>
              {lessonDate(lesson.scheduled_at_utc, group.timezone, locale)} ·{" "}
              {lessonTime(lesson.scheduled_at_utc, group.timezone, locale)}
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", tone)}>
              {overdue ? t("lessonStatus.OVERDUE") : t(`lessonStatus.${lesson.status}`)}
            </span>
            {lesson.extra && <span className="text-muted-foreground text-xs">{t("lessons.extra")}</span>}
            {lesson.moved && <span className="text-muted-foreground text-xs">{t("lessons.moved")}</span>}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {t("minutes", { count: lesson.duration_minutes })}
            {lesson.teacher_id !== group.teacher_id && lesson.teacher_name
              ? ` · ${t("lessons.substitute", { name: lesson.teacher_name })}`
              : ""}
            {lesson.status === "CANCELLED" && lesson.cancel_reason ? ` · ${lesson.cancel_reason}` : ""}
            {lesson.status === "HELD" && lesson.topic ? ` · ${lesson.topic}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {c && lesson.status === "HELD" && (
            <span className="text-sm tabular-nums" title={t("lessons.countsTitle")}>
              <strong className="text-emerald-600 dark:text-emerald-400">{c.present + c.late}</strong>
              <span className="text-muted-foreground"> / {c.expected}</span>
              {c.absent > 0 && <span className="ms-2 text-rose-600 dark:text-rose-400">−{c.absent}</span>}
            </span>
          )}
          {c && lesson.status === "SCHEDULED" && (
            <span className="text-muted-foreground text-xs">{t("students", { count: c.expected })}</span>
          )}
          {canMark && lesson.status !== "CANCELLED" && (
            <Button
              type="button"
              size="sm"
              variant={lesson.status === "HELD" ? "outline" : "default"}
              className="gap-1.5"
              onClick={() => setModal({ kind: "sheet", lesson })}
              data-testid={`lesson-mark-${lesson.id}`}
            >
              <ClipboardCheck className="size-3.5" />
              {lesson.status === "HELD" ? t("lessons.editSheet") : t("lessons.takeAttendance")}
            </Button>
          )}
          {menu.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <button
                  type="button"
                  aria-label={t("lessons.more")}
                  className="hover:bg-muted inline-flex size-8 items-center justify-center rounded-lg"
                >
                  <Ellipsis className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {menu.map((m) => (
                  <DropdownMenuItem key={m.key} onClick={m.onClick} destructive={m.danger}>
                    <m.icon className="size-4" />
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </li>
    );
  }

  const visibleUpcoming = showAllUpcoming ? upcoming : upcoming.slice(0, UPCOMING_PREVIEW);

  return (
    <div className="space-y-4">
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {canManage && group.status === "ACTIVE" && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setModal({ kind: "extra" })}>
            <CalendarPlus className="size-3.5" />
            {t("lessons.addExtra")}
          </Button>
        </div>
      )}

      {loading && lessons.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{t("loading")}</p>
      ) : (
        <>
          {owed.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300">
                <AlertTriangle className="size-4" />
                {t("lessons.owed", { count: owed.length })}
              </h3>
              <ul className="divide-y overflow-hidden rounded-xl border border-rose-500/30" data-testid="lessons-owed">
                {owed.map(renderRow)}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("lessons.upcoming")}</h3>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
                {t("lessons.noUpcoming")}
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border" data-testid="lessons-upcoming">
                {visibleUpcoming.map(renderRow)}
              </ul>
            )}
            {upcoming.length > UPCOMING_PREVIEW && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllUpcoming((v) => !v)}>
                {showAllUpcoming ? t("lessons.showLess") : t("lessons.showAll", { count: upcoming.length })}
              </Button>
            )}
          </section>

          {past.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("lessons.past")}</h3>
              <ul className="divide-y overflow-hidden rounded-xl border" data-testid="lessons-past">
                {past.map(renderRow)}
              </ul>
            </section>
          )}
        </>
      )}

      <Modal
        open={modal.kind === "sheet"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("sheet.title")}
        size="lg"
      >
        {modal.kind === "sheet" && (
          <AttendanceSheet
            lessonId={modal.lesson.id}
            onCancel={() => setModal({ kind: "closed" })}
            onSaved={() => done(t("sheet.saved"))}
          />
        )}
      </Modal>

      <Modal open={modal.kind === "move"} onClose={() => setModal({ kind: "closed" })} title={t("lessons.moveTitle")}>
        {modal.kind === "move" && (
          <LessonTimeForm
            group={group}
            initialIso={modal.lesson.scheduled_at_utc}
            initialDuration={modal.lesson.duration_minutes}
            submitLabel={t("lessons.moveConfirm")}
            busy={busy}
            onCancel={() => setModal({ kind: "closed" })}
            onSubmit={(v) =>
              run(async () => {
                const res = await rescheduleGroupLesson(modal.lesson.id, v);
                return res.warnings.map((w) => w.message).join(" · ");
              }, t("lessons.movedNotice"))
            }
          />
        )}
      </Modal>

      <Modal open={modal.kind === "extra"} onClose={() => setModal({ kind: "closed" })} title={t("lessons.addExtra")} description={t("lessons.extraHint")}>
        {modal.kind === "extra" && (
          <LessonTimeForm
            group={group}
            initialDuration={group.slots[0]?.duration_minutes ?? 60}
            submitLabel={t("lessons.addExtraConfirm")}
            busy={busy}
            onCancel={() => setModal({ kind: "closed" })}
            onSubmit={(v) =>
              run(async () => {
                const res = await addGroupLesson(group.id, {
                  local_datetime: v.local_datetime,
                  duration_minutes: v.duration_minutes,
                });
                return res.warnings.map((w) => w.message).join(" · ");
              }, t("lessons.extraAdded"))
            }
          />
        )}
      </Modal>

      <Modal open={modal.kind === "cancel"} onClose={() => setModal({ kind: "closed" })} title={t("lessons.cancelTitle")} description={t("lessons.cancelHint")}>
        {modal.kind === "cancel" && (
          <ReasonForm
            busy={busy}
            confirmLabel={t("lessons.cancelConfirm")}
            onCancel={() => setModal({ kind: "closed" })}
            onSubmit={(reason) =>
              run(async () => {
                await cancelGroupLesson(modal.lesson.id, reason);
              }, t("lessons.cancelled"))
            }
          />
        )}
      </Modal>

      <Modal open={modal.kind === "revert"} onClose={() => setModal({ kind: "closed" })} title={t("lessons.revertTitle")} description={t("lessons.revertHint")}>
        {modal.kind === "revert" && (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setModal({ kind: "closed" })} disabled={busy}>
              {t("form.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await revertGroupLesson(modal.lesson.id);
                }, t("lessons.reverted"))
              }
            >
              {t("lessons.revertConfirm")}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Date + time + length — the shared body of "move this lesson" and "add an extra lesson". */
function LessonTimeForm({
  group,
  initialIso,
  initialDuration,
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: {
  group: GroupDetail;
  initialIso?: string;
  initialDuration: number;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { local_datetime: string; duration_minutes: number }) => void;
}) {
  const t = useTranslations("groups");
  const start = initialIso ? localDateTime(initialIso, group.timezone) : { date: todayIn(group.timezone), time: group.slots[0]?.start_time_local ?? "17:00" };
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [duration, setDuration] = useState(String(initialDuration));

  const valid = date && time && Number(duration) >= 1 && Number(duration) <= 600;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1.5 sm:col-span-1">
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
      <p className="text-muted-foreground text-xs">{t("lessons.timezoneHint", { tz: group.timezone })}</p>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button
          type="button"
          disabled={busy || !valid}
          onClick={() => onSubmit({ local_datetime: `${date} ${time}`, duration_minutes: Number(duration) })}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function ReasonForm({
  busy,
  confirmLabel,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onSubmit: (reason: string | null) => void;
}) {
  const t = useTranslations("groups");
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("lessons.reason")}</span>
        <input
          className={fieldClass}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("lessons.reasonPlaceholder")}
        />
      </label>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => onSubmit(reason.trim() || null)}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
