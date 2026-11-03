"use client";

import { Check, Loader2, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "@/components/attendance/status-badge";
import { useAuth } from "@/components/auth-provider";
import {
  AddLessonDialog,
  EditLessonDialog,
  RemoveLessonDialog,
} from "@/components/payroll/payroll-lesson-dialogs";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  attendPayrollLesson,
  getPayrollRangeLessons,
  type PayrollAddedLesson,
  type PayrollLessonNotOnSalary,
  type PayrollRangeLesson,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface TeacherRangeTarget {
  teacherId: string;
  teacherName: string | null;
  currency: string;
}

/**
 * The lessons behind one teacher's "lessons" figure for the chosen window, and the place to correct
 * them: change a length, remove a wrong lesson, add a missing one, or count one that is sitting
 * unmarked.
 *
 * Owners looked at that figure on the by-teacher summary and asked where the lessons were: they
 * only lived inside each monthly statement further down, and a window can span two of those.
 * This reads the same slice the summary sums (`session_date` inside the window), so the total at
 * the bottom is always the number they tapped. What a correction does to money is the server's to
 * decide, sealed months included: each dialog shows its calculation before anything is saved.
 */
export function TeacherRangeLessonsModal({
  target,
  from,
  to,
  onClose,
  onMutated,
}: {
  target: TeacherRangeTarget | null;
  from: string;
  to: string;
  onClose: () => void;
  /** Called on close when a lesson changed, so the figures behind this popup can refresh. */
  onMutated?: () => void;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const { can } = useAuth();
  const canCorrect = can("payout.adjust");

  const [lessons, setLessons] = useState<PayrollRangeLesson[] | null>(null);
  const [notOnSalary, setNotOnSalary] = useState<PayrollLessonNotOnSalary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<PayrollRangeLesson | null>(null);
  const [removing, setRemoving] = useState<PayrollRangeLesson | null>(null);
  const [adding, setAdding] = useState(false);
  const [countingId, setCountingId] = useState<string | null>(null);

  // A reload can outrun the previous response; only the newest one lands.
  const seq = useRef(0);
  const mutated = useRef(false);

  const load = useCallback(async () => {
    if (target === null) return;
    const current = ++seq.current;
    try {
      const res = await getPayrollRangeLessons(target.teacherId, from, to, target.currency);
      if (current !== seq.current) return;
      setLessons(res.lessons);
      setNotOnSalary(res.not_on_salary);
    } catch (err) {
      if (current === seq.current) setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [target, from, to]);

  useEffect(() => {
    if (target === null) return;
    setLessons(null);
    setNotOnSalary([]);
    setError(null);
    setNotice(null);
    mutated.current = false;
    void load();
  }, [target, load]);

  // session_date is a plain academy-local date; pin the formatter to UTC so it never shifts a day.
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    [locale],
  );

  const totals = useMemo(
    () =>
      (lessons ?? []).reduce(
        (acc, l) => ({
          minutes: acc.minutes + (l.duration_minutes ?? 0),
          amount: acc.amount + l.amount_minor,
        }),
        { minutes: 0, amount: 0 },
      ),
    [lessons],
  );

  const money = (amount: number) =>
    formatMoney({ amount, currency: target?.currency ?? "EGP" }, locale);

  function close() {
    if (mutated.current) onMutated?.();
    mutated.current = false;
    onClose();
  }

  function corrected(message: string | null) {
    mutated.current = true;
    setEditing(null);
    setRemoving(null);
    setAdding(false);
    setNotice(message);
    void load();
  }

  const statementNote = (done: PayrollAddedLesson) =>
    done.carried
      ? t("lessonCarried", { period: `${String(done.statement_month).padStart(2, "0")}/${done.statement_year}` })
      : t("lessonCounted");

  async function count(sessionId: string) {
    setCountingId(sessionId);
    setError(null);
    try {
      corrected(statementNote(await attendPayrollLesson(sessionId)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setCountingId(null);
    }
  }

  const formatDate = (date: string | null) =>
    date ? dateFmt.format(new Date(`${date}T00:00:00Z`)) : "—";

  const anySealed = lessons?.some((l) => l.finalized && !l.removed) ?? false;
  const anyGroup = lessons?.some((l) => l.session_id === null) ?? false;

  return (
    <>
      <Modal
        open={target !== null}
        onClose={close}
        title={t("rangeLessonsTitle", { name: target?.teacherName ?? "—" })}
        description={t("rangeLessonsWindow", { from, to })}
        size="lg"
        footer={
          lessons && lessons.length > 0 ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {t("sessionCount", { count: lessons.length })} · {formatHours(totals.minutes, locale)}
              </span>
              <span className="font-bold tabular-nums">{money(totals.amount)}</span>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-4">
          {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
          {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}

          {canCorrect && lessons !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-relaxed">
                {anySealed ? t("lessonSealedHint") : t("lessonCorrectHint")}
              </p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={() => setAdding(true)}
                data-testid="lesson-add"
              >
                <Plus className="size-3.5" aria-hidden />
                {t("lessonAdd")}
              </Button>
            </div>
          )}

          {!error && lessons === null && (
            <p className="text-muted-foreground py-6 text-center text-sm">{t("rangeLessonsLoading")}</p>
          )}

          {lessons !== null && lessons.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">{t("rangeLessonsEmpty")}</p>
          )}

          {lessons !== null && lessons.length > 0 && (
            <ul className="divide-border divide-y rounded-xl border" data-testid="range-lessons">
              {lessons.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate font-medium", l.removed && "text-muted-foreground line-through")}>
                      {l.student_name ?? l.group_name ?? "—"}
                    </p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {formatDate(l.session_date)}
                      {l.duration_minutes !== null && <> · {formatHours(l.duration_minutes, locale)}</>}
                    </p>
                    {l.removed && (
                      <p className="text-xs text-amber-700 dark:text-amber-400" data-testid={`lesson-removed-${l.id}`}>
                        {t("lessonRemovedTag")}
                      </p>
                    )}
                  </div>
                  {l.finalized && (
                    <Lock
                      className="text-muted-foreground size-3.5 shrink-0"
                      aria-label={t("status.FINALIZED")}
                    />
                  )}
                  <span className="shrink-0 font-semibold tabular-nums">{money(l.amount_minor)}</span>
                  {canCorrect && l.session_id !== null && !l.removed && (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("lessonEditTitle")}
                        onClick={() => setEditing(l)}
                        data-testid={`lesson-edit-${l.id}`}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("lessonRemoveTitle")}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoving(l)}
                        data-testid={`lesson-remove-${l.id}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canCorrect && anyGroup && (
            <p className="text-muted-foreground text-xs leading-relaxed">{t("lessonGroupHint")}</p>
          )}

          {canCorrect && notOnSalary.length > 0 && (
            <section className="space-y-2" data-testid="not-on-salary">
              <div>
                <h3 className="text-sm font-semibold">{t("lessonNotOnSalaryTitle")}</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">{t("lessonNotOnSalaryHint")}</p>
              </div>
              <ul className="divide-border divide-y rounded-xl border">
                {notOnSalary.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.student_name ?? "—"}</p>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {formatDate(s.session_date)} · <span dir="ltr">{s.local_time}</span> · {formatHours(s.duration_minutes, locale)}
                      </p>
                    </div>
                    <StatusBadge status={s.status} className="shrink-0" />
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      disabled={countingId !== null}
                      onClick={() => void count(s.id)}
                      data-testid={`lesson-count-${s.id}`}
                    >
                      {countingId === s.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Check className="size-3.5" aria-hidden />
                      )}
                      {t("lessonCount")}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Modal>

      {editing !== null && (
        <EditLessonDialog
          lesson={editing}
          onClose={() => setEditing(null)}
          onDone={() => corrected(t("lessonEdited"))}
        />
      )}
      {removing !== null && (
        <RemoveLessonDialog
          lesson={removing}
          onClose={() => setRemoving(null)}
          onDone={() => corrected(t("lessonRemoved"))}
        />
      )}
      {adding && target !== null && (
        <AddLessonDialog
          teacherId={target.teacherId}
          from={from}
          to={to}
          onClose={() => setAdding(false)}
          onDone={(done) => corrected(statementNote(done))}
        />
      )}
    </>
  );
}
