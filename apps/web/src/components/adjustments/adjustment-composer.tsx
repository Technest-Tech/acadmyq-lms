"use client";

import { AlertTriangle, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  addTeacherAdjustment,
  ApiError,
  type AdjustmentType,
  type TeacherRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

/**
 * Give a teacher an award, or dock them.
 *
 * Unlike the payroll page's version this is addressed by TEACHER + PERIOD rather than by an
 * existing statement, so a teacher who has taught nothing this month can still be rewarded — the
 * API opens their statement on demand. That is the whole reason this form exists separately: a
 * student's thank-you shouldn't be un-payable because payroll hasn't accrued yet.
 */
export function AdjustmentComposer({
  open,
  teachers,
  presetType,
  presetTeacherId,
  onClose,
  onCreated,
}: {
  open: boolean;
  teachers: TeacherRow[];
  presetType?: AdjustmentType;
  presetTeacherId?: string | null;
  onClose: () => void;
  onCreated: (type: AdjustmentType) => void;
}) {
  const t = useTranslations("adjustments");
  const locale = useLocale();
  const now = new Date();

  const [type, setType] = useState<AdjustmentType>(presetType ?? "REWARD");
  const [teacherId, setTeacherId] = useState(presetTeacherId ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(presetType ?? "REWARD");
    setTeacherId(presetTeacherId ?? "");
    setAmount("");
    setReason("");
    setDetails("");
    setError(null);
  }, [open, presetType, presetTeacherId]);

  const teacher = useMemo(
    () => teachers.find((row) => row.id === teacherId) ?? null,
    [teachers, teacherId],
  );

  // Major → minor at the input boundary, matching the payroll adjustment form. The API is the
  // authority on the arithmetic; this only converts what was typed into the unit it expects.
  const amountMinor = Math.round((Number.parseFloat(amount) || 0) * 100);
  const ready = teacherId !== "" && amountMinor > 0 && reason.trim() !== "";

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await addTeacherAdjustment(teacherId, {
        type,
        amount_minor: amountMinor,
        reason: reason.trim(),
        details: details.trim() || null,
        period_year: year,
        period_month: month,
      });
      onCreated(type);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const isReward = type === "REWARD";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("composer.title")}
      description={t("composer.description")}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {amountMinor > 0 && teacher ? (
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                isReward
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
              )}
            >
              {isReward ? "+" : "−"}
              {formatMoney({ amount: amountMinor, currency: teacher.currency }, locale)}
            </p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={!ready || busy} data-testid="adjustment-save">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {isReward ? t("composer.saveReward") : t("composer.saveDeduction")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <TypeCard
            active={isReward}
            tone="reward"
            icon={TrendingUp}
            title={t("type.REWARD")}
            hint={t("composer.rewardHint")}
            onClick={() => setType("REWARD")}
            testId="adjustment-type-reward"
          />
          <TypeCard
            active={!isReward}
            tone="deduction"
            icon={TrendingDown}
            title={t("type.DEDUCTION")}
            hint={t("composer.deductionHint")}
            onClick={() => setType("DEDUCTION")}
            testId="adjustment-type-deduction"
          />
        </div>

        <Field label={t("composer.teacher")}>
          <select
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            className={cn(inputBase, "px-3 py-2")}
            data-testid="adjustment-teacher"
          >
            <option value="">{t("composer.pickTeacher")}</option>
            {teachers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.full_name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("composer.amount")}>
            <div className="relative">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.00"
                className={cn(inputBase, "px-3 py-2 pe-14 text-end tabular-nums")}
                data-testid="adjustment-amount"
              />
              <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs font-medium">
                {teacher?.currency ?? ""}
              </span>
            </div>
          </Field>

          <Field label={t("composer.period")}>
            <div className="flex gap-2">
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={cn(inputBase, "px-3 py-2")}
                aria-label={t("composer.month")}
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className={cn(inputBase, "px-3 py-2")}
                aria-label={t("composer.year")}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>

        <Field label={t("composer.reason")}>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder={
              isReward ? t("composer.reasonRewardPlaceholder") : t("composer.reasonDeductionPlaceholder")
            }
            className={cn(inputBase, "px-3 py-2")}
            data-testid="adjustment-reason"
          />
          <p className="text-muted-foreground/70 mt-1 text-xs">{t("composer.reasonHint")}</p>
        </Field>

        <Field label={t("composer.details")} optional>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={2}
            maxLength={2000}
            className={cn(inputBase, "resize-y px-3 py-2")}
          />
        </Field>
      </div>
    </Modal>
  );
}

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("adjustments");
  return (
    <div className="space-y-1.5">
      <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        {label}
        {optional && (
          <span className="text-muted-foreground/60 font-normal">({t("optional")})</span>
        )}
      </label>
      {children}
    </div>
  );
}

function TypeCard({
  active,
  tone,
  icon: Icon,
  title,
  hint,
  onClick,
  testId,
}: {
  active: boolean;
  tone: "reward" | "deduction";
  icon: typeof TrendingUp;
  title: string;
  hint: string;
  onClick: () => void;
  testId: string;
}) {
  const activeClass =
    tone === "reward"
      ? "border-emerald-500 bg-emerald-50 ring-emerald-500/15 dark:bg-emerald-950/20"
      : "border-red-500 bg-red-50 ring-red-500/15 dark:bg-red-950/20";
  const iconClass =
    tone === "reward"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "rounded-xl border p-3 text-start transition-all",
        active ? `${activeClass} ring-3` : "hover:border-muted-foreground/30",
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon className={cn("size-4", active ? iconClass : "text-muted-foreground")} aria-hidden />
        <span className="text-sm font-semibold">{title}</span>
      </span>
      <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">{hint}</span>
    </button>
  );
}
