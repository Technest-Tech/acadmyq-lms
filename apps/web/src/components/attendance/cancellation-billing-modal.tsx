"use client";

import { GraduationCap, Loader2, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export interface CancellationBillingValues {
  charge_student: boolean;
  pay_teacher: boolean;
  reason: string;
}

/** A two-option Yes/No segmented control. */
function YesNo({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("attendance.cancelBilling");
  return (
    <div className="bg-muted/60 inline-flex shrink-0 rounded-lg p-0.5">
      {[true, false].map((opt) => (
        <button
          key={String(opt)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
            value === opt
              ? opt
                ? "bg-emerald-500 text-white shadow-sm"
                : "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt ? t("yes") : t("no")}
        </button>
      ))}
    </div>
  );
}

/**
 * Asked whenever an owner cancels a class (directly or by approving a teacher's request): the
 * academy decides, per cancellation, whether to still charge the student (a late-cancel fee, at
 * the full session price) and/or pay the teacher, plus a reason the parent sees on the invoice.
 */
export function CancellationBillingModal({
  open,
  onClose,
  cancelType,
  defaultReason = "",
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  cancelType: "teacher" | "student";
  defaultReason?: string;
  busy?: boolean;
  onConfirm: (values: CancellationBillingValues) => void | Promise<void>;
}) {
  const t = useTranslations("attendance.cancelBilling");
  const [chargeStudent, setChargeStudent] = useState(false);
  const [payTeacher, setPayTeacher] = useState(false);
  const [reason, setReason] = useState(defaultReason);

  // Reset to defaults each time the modal is (re)opened so a prior cancellation never leaks in.
  useEffect(() => {
    if (open) {
      setChargeStudent(false);
      setPayTeacher(false);
      setReason(defaultReason);
    }
  }, [open, defaultReason]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title")}
      description={t(`subtitle.${cancelType}`)}
      size="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() =>
              void onConfirm({
                charge_student: chargeStudent,
                pay_teacher: payTeacher,
                reason: reason.trim(),
              })
            }
            data-testid="cancel-billing-confirm"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {t("confirm")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Charge the student */}
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <UserRound className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("chargeStudent")}</p>
              <p className="text-muted-foreground text-xs">{t("chargeStudentHint")}</p>
            </div>
          </div>
          <YesNo value={chargeStudent} onChange={setChargeStudent} disabled={busy} />
        </div>

        {/* Pay the teacher */}
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <GraduationCap className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("payTeacher")}</p>
              <p className="text-muted-foreground text-xs">{t("payTeacherHint")}</p>
            </div>
          </div>
          <YesNo value={payTeacher} onChange={setPayTeacher} disabled={busy} />
        </div>

        {/* Reason (shown to the parent when charged) */}
        <div className="space-y-1.5">
          <label htmlFor="cancel-reason" className="text-sm font-semibold">
            {t("reason")}
          </label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            rows={3}
            maxLength={500}
            placeholder={t("reasonPlaceholder")}
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full resize-none rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50"
          />
          {chargeStudent && (
            <p className="text-muted-foreground text-xs">{t("reasonParentNote")}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
