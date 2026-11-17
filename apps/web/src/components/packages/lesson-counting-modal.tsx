"use client";

import { ArrowLeftRight, Check, Loader2, Wallet } from "lucide-react";
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
  previewLessonCounting,
  setLessonCounting,
  type LessonCountingEffect,
  type PackageLesson,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const SHARES: TeacherShare[] = [0, 25, 50, 100];

function asShare(percent: number | null | undefined): TeacherShare {
  return SHARES.includes((percent ?? 0) as TeacherShare) ? ((percent ?? 0) as TeacherShare) : 100;
}

/**
 * A cancelled lesson: does it count on the student's package, and what is the teacher paid of it
 * (Ahmed 2026-11-17)? Before saving, it says what moves — the block the lesson comes off or goes
 * back to, lessons coming back from the next block, a block re-opening and its unused renewal
 * undone, the teacher's salary month — then the server works the blocks and the salary out again.
 */
export function LessonCountingModal({
  lesson,
  onClose,
  onSaved,
}: {
  lesson: PackageLesson;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTranslations("packages.counting");
  const tStatus = useTranslations("scheduling");
  const locale = useLocale();
  const startCounts = lesson.counts ?? false;
  const startShare = asShare(lesson.teacher_pay_percent ?? 0);
  const [counts, setCounts] = useState(startCounts);
  const [share, setShare] = useState<TeacherShare>(startShare);
  const [effect, setEffect] = useState<LessonCountingEffect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = counts !== startCounts || share !== startShare;

  // What this choice would do, read again whenever it changes.
  useEffect(() => {
    if (!changed) {
      setEffect(null);
      return;
    }
    let live = true;
    void previewLessonCounting(lesson.id, counts, share)
      .then((res) => live && setEffect(res))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [changed, counts, share, lesson.id]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setLessonCounting(lesson.id, counts, share);
      onSaved(t("saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const when = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: academyTimeZone() }).format(
    new Date(lesson.scheduled_at_utc),
  );
  const blocked = effect?.blocker ?? null;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={t("title")}
      description={`${when} · ${tStatus(`status.${lesson.status}`)}`}
      size="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !changed || blocked !== null}
            onClick={() => void save()}
            data-testid="lesson-counting-save"
            className="gap-1.5"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
            {t("save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="lesson-counting">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        {/* The student's side: does it come off the package? */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t("student")}</span>
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
                  {option ? t("counts") : t("notCounts")}
                </span>
                <span className="text-muted-foreground block text-[11px]">{option ? t("countsHint") : t("notCountsHint")}</span>
              </button>
            ))}
          </div>
        </div>

        {/* The teacher's side: none, a quarter, a half, the whole lesson. */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t("teacher")}</span>
          <TeacherShareChoice value={share} onChange={setShare} disabled={busy} />
        </div>

        {/* What it does, before it is done. */}
        {changed && (
          <div className="bg-muted/40 space-y-1.5 rounded-xl border px-3.5 py-3 text-xs" data-testid="lesson-counting-effect">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <ArrowLeftRight className="text-primary size-4" aria-hidden />
              {t("effectTitle")}
            </p>
            {effect === null ? (
              <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />
            ) : (
              <EffectLines effect={effect} locale={locale} />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EffectLines({ effect, locale }: { effect: LessonCountingEffect; locale: string }) {
  const t = useTranslations("packages.counting");
  const s = effect.student;
  const n = s.package?.sequence_no ?? 0;
  const lines: string[] = [];

  if (effect.blocker) lines.push(t(`blocker.${effect.blocker}`));
  if (s.mode === "ADD") lines.push(s.package ? t("add", { n }) : t("addNoPackage"));
  if (s.mode === "ADD" && s.will_complete) lines.push(t("willComplete", { n }));
  if (s.mode === "RELEASE") lines.push(t("release", { n }));
  if (s.mode === "UNBILL") lines.push(t("unbill"));
  if (s.mode === "FINISHED_PLAN") {
    lines.push(t("finished", { n }));
    if (s.lessons_moved_back) lines.push(t("movedBack", { count: s.lessons_moved_back.lessons, from: s.lessons_moved_back.sequence_no, n }));
    if (s.reopens) lines.push(t("reopens", { n }));
    if (s.renewal_undone) lines.push(t("renewalUndone"));
    if (s.stays_closed) lines.push(t("staysClosed", { n }));
  }

  const tc = effect.teacher;
  if (tc.percent_after !== tc.percent_before) {
    if (tc.locked) {
      lines.push(t("teacherLocked"));
    } else {
      lines.push(t("teacherChange", { before: t(`share.${tc.percent_before}`), after: t(`share.${tc.percent_after}`) }));
      if (tc.statement) {
        const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(tc.statement.year, tc.statement.month - 1, 1));
        lines.push(tc.statement.sealed ? t("statementSealed", { month }) : t("statementOpen", { month }));
      }
      if (tc.amount_before > 0 && tc.currency) {
        lines.push(t("teacherBefore", { amount: formatMoney({ amount: tc.amount_before, currency: tc.currency }, locale) }));
      }
    }
  }

  return (
    <ul className="space-y-1">
      {lines.map((line) => (
        <li key={line} className={cn("flex items-start gap-1.5", effect.blocker && line === lines[0] && "text-destructive font-semibold")}>
          <Wallet className="text-muted-foreground mt-px size-3 shrink-0" aria-hidden />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * On a cancelled lesson's row in a package's log: how it stands (counts or not · the teacher's
 * share) and the button that changes it. Nothing for any other lesson, or for someone who may not
 * move a cancellation's money.
 */
export function LessonCountingAction({ lesson, onChanged }: { lesson: PackageLesson; onChanged: (message: string) => void }) {
  const t = useTranslations("packages.counting");
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!(COUNTABLE_CANCEL_STATUSES as readonly string[]).includes(lesson.status)) return null;
  const mayChange = can("package.manage") && can("session.bill_override");
  const share = lesson.teacher_pay_percent ?? 0;

  return (
    <span className="flex shrink-0 flex-col items-end gap-1" data-testid={`lesson-counting-${lesson.id}`}>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-bold",
          lesson.counts ? "bg-amber-500/12 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground",
        )}
      >
        {lesson.counts ? t("chipCounts") : t("chipNotCounts")}
        {share > 0 && <> · {t("chipTeacher", { share: t(`share.${share}`) })}</>}
      </span>
      {mayChange && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-primary text-[11px] font-semibold underline-offset-4 hover:underline"
          data-testid={`lesson-counting-edit-${lesson.id}`}
        >
          {t("edit")}
        </button>
      )}
      {open && (
        <LessonCountingModal
          lesson={lesson}
          onClose={() => setOpen(false)}
          onSaved={(message) => {
            setOpen(false);
            onChanged(message);
          }}
        />
      )}
    </span>
  );
}
