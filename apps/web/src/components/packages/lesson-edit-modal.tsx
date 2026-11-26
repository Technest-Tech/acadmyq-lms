"use client";

import { ArrowLeftRight, Check, Loader2, Pencil, Trash2, TriangleAlert, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { TeacherShareChoice, type TeacherShare } from "@/components/attendance/cancellation-billing-modal";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { academyTimeZone } from "@/lib/academy-clock";
import {
  ApiError,
  COUNTABLE_CANCEL_STATUSES,
  deletePackageLesson,
  LESSON_LOG_OUTCOMES,
  previewLessonCounting,
  previewPackageLessonDelete,
  setLessonCounting,
  type LessonCountingEffect,
  type LessonEffectBlock,
  type LessonLogOutcome,
  type PackageLesson,
} from "@/lib/api";
import { useCentreLook } from "@/lib/capabilities";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/*
 * A lesson in a package's log, corrected or deleted (Ahmed 2026-11-26) — on any block, the old ones
 * too. Taking a lesson off a block that finished moves every block after it, down to the running
 * one: the server works that out and says it before anything is written, block by block, and the
 * change is confirmed twice, the second time saying that every package moves, due and new ones too.
 */

const SHARES: TeacherShare[] = [0, 25, 50, 100];

function asShare(percent: number | null | undefined): TeacherShare {
  return SHARES.includes((percent ?? 0) as TeacherShare) ? ((percent ?? 0) as TeacherShare) : 100;
}

const isCancellation = (status: string) => (COUNTABLE_CANCEL_STATUSES as readonly string[]).includes(status);
const asOutcome = (status: string): LessonLogOutcome | null =>
  (LESSON_LOG_OUTCOMES as readonly string[]).includes(status) ? (status as LessonLogOutcome) : null;

/** edit → "sure?" → the last word: every package moves. */
type Step = "edit" | "confirm" | "final";

function useLessonWhen(lesson: PackageLesson): string {
  const locale = useLocale();
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: academyTimeZone() }).format(
    new Date(lesson.scheduled_at_utc),
  );
}

/** Correct a lesson's outcome — and, for a cancellation, whether it counts and the teacher's share. */
export function LessonEditModal({
  lesson,
  onClose,
  onSaved,
}: {
  lesson: PackageLesson;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTranslations("packages.lessonEdit");
  const tc = useTranslations("packages.counting");
  const tStatus = useTranslations("scheduling");
  const { can } = useAuth();
  const when = useLessonWhen(lesson);
  const mayMark = can("session.mark_attendance");

  const startOutcome = asOutcome(lesson.status);
  const startCounts = lesson.counts ?? false;
  const startShare = asShare(lesson.teacher_pay_percent ?? 0);
  const [outcome, setOutcome] = useState<LessonLogOutcome | null>(startOutcome);
  const [counts, setCounts] = useState(startCounts);
  const [share, setShare] = useState<TeacherShare>(startShare);
  const [effect, setEffect] = useState<LessonCountingEffect | null>(null);
  const [step, setStep] = useState<Step>("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outcomeChanged = outcome !== null && outcome !== startOutcome;
  const statusAfter = outcome ?? lesson.status;
  const cancelled = isCancellation(statusAfter);
  // A delivered lesson counts and pays in full, one on the house neither; a cancellation is chosen.
  const countsAfter = statusAfter === "ATTENDED" ? true : cancelled ? counts : false;
  const shareAfter = statusAfter === "ATTENDED" ? 100 : cancelled ? share : 0;
  const changed = outcomeChanged || (cancelled && (counts !== startCounts || share !== startShare));
  const sentStatus = outcomeChanged ? (outcome ?? undefined) : undefined;

  function pick(next: LessonLogOutcome) {
    setOutcome(next);
    setStep("edit");
    // Back to where it stood, or a fresh cancellation: not counted, nothing for the teacher.
    setCounts(next === startOutcome ? startCounts : false);
    setShare(next === startOutcome ? startShare : 0);
  }

  // What this choice would do, read again whenever it changes.
  useEffect(() => {
    if (!changed) {
      setEffect(null);
      return;
    }
    let live = true;
    setEffect(null);
    void previewLessonCounting(lesson.id, countsAfter, shareAfter, sentStatus)
      .then((res) => live && setEffect(res))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [changed, countsAfter, shareAfter, sentStatus, lesson.id]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setLessonCounting(lesson.id, countsAfter, shareAfter, sentStatus);
      onSaved(t("edited"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setStep("edit");
    } finally {
      setBusy(false);
    }
  }

  const blocked = effect?.blocker ?? null;
  const ready = changed && effect !== null && blocked === null;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={t("editTitle")}
      description={`${when} · ${tStatus(`status.${lesson.status}`)}`}
      size="md"
      footer={
        <StepFooter
          step={step}
          busy={busy}
          ready={ready}
          saveLabel={t("save")}
          finalLabel={t("finalEdit")}
          onCancel={onClose}
          onStep={setStep}
          onApply={() => void save()}
        />
      }
    >
      <div className="space-y-4" data-testid="lesson-edit">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        {step === "edit" && (
          <>
            {mayMark && (
              <div className="space-y-1.5">
                <span className="text-sm font-medium">{t("outcome")}</span>
                <div className="grid grid-cols-2 gap-2">
                  {LESSON_LOG_OUTCOMES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={outcome === option}
                      onClick={() => pick(option)}
                      data-testid={`lesson-outcome-${option}`}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-start text-sm font-semibold transition-colors",
                        outcome === option ? "border-primary/40 bg-primary/8 text-primary ring-primary/15 ring-2" : "hover:bg-muted/40",
                      )}
                    >
                      {tStatus(`status.${option}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {cancelled && (
              <>
                {/* The student's side: does it come off the package? */}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">{tc("student")}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[true, false].map((option) => (
                      <button
                        key={String(option)}
                        type="button"
                        aria-pressed={counts === option}
                        onClick={() => setCounts(option)}
                        data-testid={option ? "lesson-counts-yes" : "lesson-counts-no"}
                        className={cn(
                          "rounded-xl border px-3 py-2.5 text-start transition-colors",
                          counts === option ? "border-primary/40 bg-primary/8 ring-primary/15 ring-2" : "hover:bg-muted/40",
                        )}
                      >
                        <span className={cn("block text-sm font-semibold", counts === option && "text-primary")}>
                          {option ? tc("counts") : tc("notCounts")}
                        </span>
                        <span className="text-muted-foreground block text-[11px]">{option ? tc("countsHint") : tc("notCountsHint")}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* The teacher's side: none, a quarter, a half, the whole lesson. */}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">{tc("teacher")}</span>
                  <TeacherShareChoice value={share} onChange={setShare} disabled={busy} />
                </div>
              </>
            )}
          </>
        )}

        {step === "confirm" && (
          <p className="text-sm font-semibold" data-testid="lesson-edit-confirm">
            {outcomeChanged
              ? t("confirmOutcome", { before: tStatus(`status.${lesson.status}`), after: tStatus(`status.${statusAfter}`) })
              : t("confirmEdit")}
          </p>
        )}
        {step === "final" && <FinalWarning text={t("finalWarning")} />}

        {/* What it does, before it is done. */}
        {changed && <EffectPanel effect={effect} />}
      </div>
    </Modal>
  );
}

/** Delete a lesson from the log: off the package, the blocks after it, the salary — and hidden. */
export function LessonDeleteModal({
  lesson,
  onClose,
  onDeleted,
}: {
  lesson: PackageLesson;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const t = useTranslations("packages.lessonEdit");
  const tStatus = useTranslations("scheduling");
  const when = useLessonWhen(lesson);
  const [effect, setEffect] = useState<LessonCountingEffect | null>(null);
  const [step, setStep] = useState<Step>("confirm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void previewPackageLessonDelete(lesson.id)
      .then((res) => live && setEffect(res))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [lesson.id]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deletePackageLesson(lesson.id);
      onDeleted(t("deleted"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setStep("confirm");
    } finally {
      setBusy(false);
    }
  }

  const ready = effect !== null && !effect.blocker;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={t("deleteTitle")}
      description={`${when} · ${tStatus(`status.${lesson.status}`)}`}
      size="md"
      footer={
        <StepFooter
          step={step}
          busy={busy}
          ready={ready}
          saveLabel={t("delete")}
          finalLabel={t("finalDelete")}
          onCancel={onClose}
          onStep={(next) => setStep(next === "edit" ? "confirm" : next)}
          onApply={() => void remove()}
          firstStep="confirm"
        />
      }
    >
      <div className="space-y-4" data-testid="lesson-delete">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
        {step === "confirm" ? (
          <p className="text-sm font-semibold" data-testid="lesson-delete-confirm">
            {t("confirmDelete")}
          </p>
        ) : (
          <FinalWarning text={t("finalWarningDelete")} />
        )}
        <EffectPanel effect={effect} />
      </div>
    </Modal>
  );
}

/**
 * The buttons for each step. Edit: [cancel] [save] → [back] [yes, go on] → [back] [yes, do it].
 * Delete starts at the second: [cancel] [delete] → [back] [yes, delete].
 */
function StepFooter({
  step,
  busy,
  ready,
  saveLabel,
  finalLabel,
  onCancel,
  onStep,
  onApply,
  firstStep = "edit",
}: {
  step: Step;
  busy: boolean;
  ready: boolean;
  saveLabel: string;
  finalLabel: string;
  onCancel: () => void;
  onStep: (step: Step) => void;
  onApply: () => void;
  firstStep?: Step;
}) {
  const t = useTranslations("packages.lessonEdit");
  const back: Step = step === "final" ? "confirm" : "edit";

  return (
    <div className="flex w-full items-center justify-end gap-2">
      {step === firstStep ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          {t("cancel")}
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onStep(back)} data-testid="lesson-step-back">
          {t("back")}
        </Button>
      )}
      {step === "edit" && (
        <Button type="button" size="sm" disabled={!ready} onClick={() => onStep("confirm")} data-testid="lesson-step-save" className="gap-1.5">
          <Check className="size-3.5" aria-hidden />
          {saveLabel}
        </Button>
      )}
      {step === "confirm" && (
        <Button
          type="button"
          size="sm"
          variant={firstStep === "confirm" ? "destructive" : "default"}
          disabled={!ready}
          onClick={() => onStep("final")}
          data-testid="lesson-step-confirm"
        >
          {firstStep === "confirm" ? saveLabel : t("continue")}
        </Button>
      )}
      {step === "final" && (
        <Button
          type="button"
          size="sm"
          disabled={busy || !ready}
          onClick={onApply}
          data-testid="lesson-step-final"
          className="bg-destructive hover:bg-destructive/85 gap-1.5 text-white"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {finalLabel}
        </Button>
      )}
    </div>
  );
}

function FinalWarning({ text }: { text: string }) {
  const t = useTranslations("packages.lessonEdit");
  return (
    <div
      className="border-destructive/30 bg-destructive/8 text-destructive flex items-start gap-2.5 rounded-xl border px-3.5 py-3"
      data-testid="lesson-final-warning"
      role="alert"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="space-y-0.5">
        <span className="block text-sm font-bold">{t("finalTitle")}</span>
        <span className="block text-xs font-medium">{text}</span>
      </span>
    </div>
  );
}

/** What the change does, block by block, then the teacher's side — or why it cannot be done. */
function EffectPanel({ effect }: { effect: LessonCountingEffect | null }) {
  const t = useTranslations("packages.lessonEdit");
  const tc = useTranslations("packages.counting");
  const locale = useLocale();

  if (effect === null) {
    return (
      <div className="bg-muted/40 flex justify-center rounded-xl border px-3.5 py-4">
        <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />
      </div>
    );
  }

  const s = effect.student;
  const blocks = s.blocks ?? [];
  const notes: string[] = [];
  if (effect.blocker) notes.push(tc(`blocker.${effect.blocker}`));
  if (s.mode === "ADD" && s.package === null) notes.push(tc("addNoPackage"));
  if (s.mode === "UNBILL") notes.push(tc("unbill"));
  if (!effect.blocker && s.mode === null) notes.push(t("noPackageChange"));

  const tch = effect.teacher;
  const teacher: string[] = [];
  if (tch.percent_after !== tch.percent_before) {
    if (tch.locked) {
      teacher.push(tc("teacherLocked"));
    } else {
      teacher.push(tc("teacherChange", { before: tc(`share.${tch.percent_before}`), after: tc(`share.${tch.percent_after}`) }));
      if (tch.statement) {
        const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(tch.statement.year, tch.statement.month - 1, 1));
        teacher.push(tch.statement.sealed ? tc("statementSealed", { month }) : tc("statementOpen", { month }));
      }
      if (tch.amount_before > 0 && tch.currency) {
        teacher.push(tc("teacherBefore", { amount: formatMoney({ amount: tch.amount_before, currency: tch.currency }, locale) }));
      }
    }
  }

  return (
    <div className="bg-muted/40 space-y-2.5 rounded-xl border px-3.5 py-3 text-xs" data-testid="lesson-effect">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <ArrowLeftRight className="text-primary size-4" aria-hidden />
        {tc("effectTitle")}
      </p>

      {notes.map((line, i) => (
        <p key={line} className={cn(effect.blocker && i === 0 && "text-destructive font-semibold")} data-testid={effect.blocker && i === 0 ? "lesson-effect-blocker" : undefined}>
          {line}
        </p>
      ))}

      {blocks.length > 0 && (
        <ul className="space-y-1.5" data-testid="lesson-effect-blocks">
          {blocks.map((block, i) => (
            <BlockLine key={block.id} block={block} prev={blocks[i - 1] ?? null} next={blocks[i + 1] ?? null} />
          ))}
        </ul>
      )}

      {teacher.length > 0 && (
        <ul className="space-y-1 border-t pt-2">
          {teacher.map((line) => (
            <li key={line} className="flex items-start gap-1.5">
              <Wallet className="text-muted-foreground mt-px size-3 shrink-0" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "#3 · 8 × 40 — 8 ← 7 of 8 lessons · gives one back to #2 · reopens". */
function BlockLine({ block, prev, next }: { block: LessonEffectBlock; prev: LessonEffectBlock | null; next: LessonEffectBlock | null }) {
  const t = useTranslations("packages.lessonEdit");
  const tc = useTranslations("packages.counting");
  const locale = useLocale();
  const lm = block.lesson_minutes;
  const used = lm
    ? t("usedLessons", { before: Math.floor(block.used_before / lm), after: Math.floor(block.used_after / lm), total: Math.floor(block.capacity / lm) })
    : t("usedHours", { before: formatHours(block.used_before, locale), after: formatHours(block.used_after, locale), total: formatHours(block.capacity, locale) });

  const notes: string[] = [];
  if (block.took_back > 0 && next) notes.push(t("tookBack", { count: block.took_back, from: next.sequence_no }));
  if (block.gave_back > 0 && prev) notes.push(t("gaveBack", { count: block.gave_back, to: prev.sequence_no }));
  if (block.status_after !== block.status_before) {
    if (block.status_after === "ACTIVE") notes.push(t("reopens"));
    else if (block.status_after === "CANCELLED") notes.push(t("cancelled"));
    else if (block.status_after === "COMPLETED") notes.push(t("completes"));
  }
  if (block.bill_voided) {
    notes.push(t("billVoided", { amount: formatMoney({ amount: block.bill_voided.amount_minor, currency: block.bill_voided.currency }, locale) }));
  }
  if (block.stays_closed) notes.push(tc("staysClosed", { n: block.sequence_no }));

  return (
    <li className="bg-card flex items-start gap-2 rounded-lg border px-2.5 py-2" data-testid={`lesson-effect-block-${block.sequence_no}`}>
      <span className="bg-foreground text-background mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums">
        #{block.sequence_no}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate font-semibold">{block.label}</span>
          <span className="text-muted-foreground tabular-nums">{used}</span>
        </span>
        {notes.length > 0 && <span className="text-muted-foreground block text-[11px]">{notes.join(" · ")}</span>}
      </span>
    </li>
  );
}

/**
 * On a lesson's row in a package's log: how a cancellation stands (counts or not · the teacher's
 * share), then edit and delete — for whoever may move a lesson's money. Nothing on a lesson the
 * timetable only plans, and nothing in a learning centre, whose lessons live on its subscriptions.
 */
export function LessonLogActions({ lesson, onChanged }: { lesson: PackageLesson; onChanged: (message: string) => void }) {
  const tc = useTranslations("packages.counting");
  const t = useTranslations("packages.lessonEdit");
  const { can } = useAuth();
  // Same rule as deleting from the attendance page: a centre's lessons live on its subscriptions.
  const centre = useCentreLook();
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);

  const planned = lesson.planned === true || lesson.id.startsWith("plan-");
  const cancellation = isCancellation(lesson.status);
  const started = Date.parse(lesson.scheduled_at_utc) <= Date.now();
  const moneyRights = can("package.manage") && can("session.bill_override");
  // A cancellation's counting needs only the money rights; correcting an outcome also marking ones.
  const mayEdit =
    !centre && !planned && started && lesson.status !== "RESCHEDULED" && moneyRights && (cancellation || can("session.mark_attendance"));
  const mayDelete = !centre && !planned && can("package.manage") && can("session.delete");
  const share = lesson.teacher_pay_percent ?? 0;

  if (!cancellation && !mayEdit && !mayDelete) return null;

  const done = (message: string) => {
    setOpen(null);
    onChanged(message);
  };

  return (
    <span className="flex shrink-0 items-center gap-1" data-testid={`lesson-actions-${lesson.id}`}>
      {cancellation && (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold",
            lesson.counts ? "bg-amber-500/12 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground",
          )}
          data-testid={`lesson-counting-${lesson.id}`}
        >
          {lesson.counts ? tc("chipCounts") : tc("chipNotCounts")}
          {share > 0 && <> · {tc("chipTeacher", { share: tc(`share.${share}`) })}</>}
        </span>
      )}
      {mayEdit && (
        <button
          type="button"
          onClick={() => setOpen("edit")}
          className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors"
          aria-label={t("edit")}
          title={t("edit")}
          data-testid={`lesson-edit-${lesson.id}`}
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
      )}
      {mayDelete && (
        <button
          type="button"
          onClick={() => setOpen("delete")}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-7 items-center justify-center rounded-md transition-colors"
          aria-label={t("delete")}
          title={t("delete")}
          data-testid={`lesson-delete-${lesson.id}`}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      )}
      {open === "edit" && <LessonEditModal lesson={lesson} onClose={() => setOpen(null)} onSaved={done} />}
      {open === "delete" && <LessonDeleteModal lesson={lesson} onClose={() => setOpen(null)} onDeleted={done} />}
    </span>
  );
}
