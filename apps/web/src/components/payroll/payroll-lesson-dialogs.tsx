"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { StudentPicker } from "@/components/groups/student-picker";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  addPayrollLesson,
  ApiError,
  getPayrollLessonRemovalPreview,
  previewPayrollLessonDuration,
  removePayrollLesson,
  updatePayrollLessonDuration,
  type PayrollAddedLesson,
  type PayrollLessonRemoval,
  type PayrollRangeLesson,
  type SessionDurationImpact,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3";

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : String(err));

function validMinutes(value: string): number | null {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 600 ? minutes : null;
}

/** Correct a lesson's length. Shows the server's own calculation of what the new length moves. */
export function EditLessonDialog({
  lesson,
  onClose,
  onDone,
}: {
  lesson: PayrollRangeLesson;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const sessionId = lesson.session_id as string;
  const [value, setValue] = useState(String(lesson.duration_minutes ?? ""));
  const [impact, setImpact] = useState<SessionDurationImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const minutes = validMinutes(value);
  const changed = minutes !== null && minutes !== lesson.duration_minutes;

  useEffect(() => {
    const current = ++seq.current;
    setImpact(null);
    setError(null);
    if (!changed) return;
    const timer = setTimeout(() => {
      previewPayrollLessonDuration(sessionId, minutes)
        .then((res) => current === seq.current && setImpact(res))
        .catch((err) => current === seq.current && setError(errorText(err)));
    }, 300);
    return () => clearTimeout(timer);
  }, [changed, minutes, sessionId]);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);

  async function save() {
    if (minutes === null) return;
    setBusy(true);
    setError(null);
    try {
      await updatePayrollLessonDuration(sessionId, minutes);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={t("lessonEditTitle")}
      description={lesson.student_name ?? undefined}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || impact === null || !impact.can_change}
            onClick={() => void save()}
            data-testid="lesson-edit-save"
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("lessonEditSave")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("lessonMinutes")}</span>
          <input
            type="number"
            min={1}
            max={600}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
            data-testid="lesson-edit-minutes"
          />
        </label>

        {impact?.blockers.includes("NOT_ATTENDED") && (
          <p className="text-destructive text-xs leading-relaxed">{t("lessonEditNotAttended")}</p>
        )}

        {impact?.can_change && (
          <ul className="bg-muted/30 space-y-1.5 rounded-xl border p-3 text-xs leading-relaxed" data-testid="lesson-edit-impact">
            {impact.payout && (
              <li>
                {t(impact.payout.finalized ? "lessonEditSalarySealed" : "lessonEditSalary", {
                  before: money(impact.payout.amount_before, impact.payout.currency),
                  after: money(impact.payout.amount_after, impact.payout.currency),
                })}
              </li>
            )}
            {impact.invoice && (
              <li>
                {impact.invoice.status === "OPEN"
                  ? t("lessonEditBill", {
                      before: money(impact.invoice.amount_before, impact.invoice.currency),
                      after: money(impact.invoice.amount_after, impact.invoice.currency),
                    })
                  : t("lessonBillLocked")}
              </li>
            )}
            {impact.package && (
              <li>
                {impact.package.status === "ACTIVE"
                  ? t("lessonEditPackage", { label: impact.package.label })
                  : t("lessonPackageLocked", { label: impact.package.label })}
              </li>
            )}
          </ul>
        )}

        {error !== null && <AlertBanner variant="error" message={error} />}
      </div>
    </Modal>
  );
}

/** Confirm removing a lesson, saying first what it does to the salary and to the student's bill. */
export function RemoveLessonDialog({
  lesson,
  onClose,
  onDone,
}: {
  lesson: PayrollRangeLesson;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const sessionId = lesson.session_id as string;
  const [effect, setEffect] = useState<PayrollLessonRemoval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPayrollLessonRemovalPreview(sessionId)
      .then((res) => !cancelled && setEffect(res))
      .catch((err) => !cancelled && setError(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await removePayrollLesson(sessionId);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const amount = formatMoney({ amount: effect?.amount_minor ?? lesson.amount_minor, currency: lesson.currency }, locale);

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={t("lessonRemoveTitle")}
      description={[lesson.student_name, lesson.session_date].filter(Boolean).join(" · ") || undefined}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy || effect === null}
            onClick={() => void confirm()}
            data-testid="lesson-remove-confirm"
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("lessonRemoveConfirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {effect === null && error === null && (
          <div className="bg-muted h-16 animate-pulse rounded-xl" />
        )}
        {effect !== null && (
          <ul className="bg-muted/30 space-y-1.5 rounded-xl border p-3 text-xs leading-relaxed" data-testid="lesson-remove-effect">
            <li>{t(effect.payout_sealed ? "lessonRemoveSalarySealed" : "lessonRemoveSalary", { amount })}</li>
            <li>{effect.student_locked ? t("lessonBillLocked") : t("lessonRemoveBill")}</li>
          </ul>
        )}
        {error !== null && <AlertBanner variant="error" message={error} />}
      </div>
    </Modal>
  );
}

/** Add a lesson that happened but is missing: it goes on the salary and the bill like any marked one. */
export function AddLessonDialog({
  teacherId,
  from,
  to,
  onClose,
  onDone,
}: {
  teacherId: string;
  from: string;
  to: string;
  onClose: () => void;
  onDone: (added: PayrollAddedLesson) => void;
}) {
  const t = useTranslations("payroll");
  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }, []);
  const lastDay = to < today ? to : today;

  const [studentId, setStudentId] = useState<string | null>(null);
  const [when, setWhen] = useState(`${lastDay}T12:00`);
  const [value, setValue] = useState("60");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutes = validMinutes(value);
  const picked = useMemo(() => new Set(studentId ? [studentId] : []), [studentId]);
  const inWindow = when.slice(0, 10) >= from && when.slice(0, 10) <= lastDay;
  const valid = studentId !== null && minutes !== null && when.length === 16 && inWindow;

  async function submit() {
    if (studentId === null || minutes === null) return;
    setBusy(true);
    setError(null);
    try {
      onDone(
        await addPayrollLesson({
          teacher_id: teacherId,
          student_id: studentId,
          local_datetime: when,
          duration_minutes: minutes,
        }),
      );
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={t("lessonAddTitle")}
      description={t("lessonAddHint")}
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !valid}
            onClick={() => void submit()}
            data-testid="lesson-add-save"
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("lessonAddSave")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{t("lessonWhen")}</span>
            <input
              type="datetime-local"
              value={when}
              min={`${from}T00:00`}
              max={`${lastDay}T23:59`}
              onChange={(e) => setWhen(e.target.value)}
              className={inputClass}
              data-testid="lesson-add-when"
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{t("lessonMinutes")}</span>
            <input
              type="number"
              min={1}
              max={600}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
              data-testid="lesson-add-minutes"
            />
          </label>
        </div>
        <StudentPicker
          picked={picked}
          onToggle={(id) => setStudentId((current) => (current === id ? null : id))}
        />
        {error !== null && <AlertBanner variant="error" message={error} />}
      </div>
    </Modal>
  );
}
