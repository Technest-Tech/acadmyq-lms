"use client";

import { Gift, Loader2, MinusCircle, PlusCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { addPayoutAdjustment, ApiError, type AdjustmentType } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface AdjustmentFormModalProps {
  open: boolean;
  payoutId: string | null;
  currency: string;
  /** Pre-select reward vs deduction when opened from a specific CTA. */
  defaultType?: AdjustmentType;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Add a REWARD (bonus) or DEDUCTION to an OPEN payout (Sprint 8+). The owner picks a type, an
 * amount (entered in major units, sent as minor), a required reason, and optional full details.
 * Money math stays on the server — this only renders a live preview of the entered amount.
 */
export function AdjustmentFormModal({
  open,
  payoutId,
  currency,
  defaultType = "REWARD",
  onClose,
  onSuccess,
}: AdjustmentFormModalProps) {
  const t = useTranslations("payroll");
  const locale = useLocale();

  const [type, setType] = useState<AdjustmentType>(defaultType);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the modal (re)opens.
  useEffect(() => {
    if (open) {
      setType(defaultType);
      setAmount("");
      setReason("");
      setDetails("");
      setError(null);
    }
  }, [open, defaultType]);

  const amountMinor = Math.round((parseFloat(amount) || 0) * 100);
  const valid = amountMinor > 0 && reason.trim().length > 0;

  async function handleSubmit() {
    if (!payoutId || !valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await addPayoutAdjustment(payoutId, {
        type,
        amount_minor: amountMinor,
        reason: reason.trim(),
        details: details.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 h-10 w-full rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";
  const labelClass = "mb-1.5 block text-sm font-medium";

  const isReward = type === "REWARD";

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("addAdjustmentTitle")}
      size="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting || !valid}
            onClick={() => void handleSubmit()}
            className={cn(
              "text-white",
              isReward
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-amber-600 hover:bg-amber-700",
            )}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : isReward ? (
              <Gift className="size-3.5" aria-hidden />
            ) : (
              <MinusCircle className="size-3.5" aria-hidden />
            )}
            {submitting
              ? t("saving")
              : isReward
                ? t("addReward")
                : t("addDeduction")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Type toggle — two premium selectable cards */}
        <div className="grid grid-cols-2 gap-3">
          <TypeCard
            active={isReward}
            onClick={() => setType("REWARD")}
            icon={PlusCircle}
            tone="emerald"
            label={t("typeReward")}
            hint={t("typeRewardHint")}
          />
          <TypeCard
            active={!isReward}
            onClick={() => setType("DEDUCTION")}
            icon={MinusCircle}
            tone="amber"
            label={t("typeDeduction")}
            hint={t("typeDeductionHint")}
          />
        </div>

        {/* Amount */}
        <div>
          <label htmlFor="adj-amount" className={labelClass}>
            {t("amountLabel")}
          </label>
          <div className="relative">
            <input
              id="adj-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              disabled={submitting}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={cn(inputClass, "pe-16 tabular-nums")}
            />
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs font-medium">
              {currency}
            </span>
          </div>
          {amountMinor > 0 && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              {isReward ? "+" : "−"}{" "}
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  isReward
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400",
                )}
              >
                {formatMoney({ amount: amountMinor, currency }, locale)}
              </span>{" "}
              {t("amountPreview")}
            </p>
          )}
        </div>

        {/* Reason (required) */}
        <div>
          <label htmlFor="adj-reason" className={labelClass}>
            {t("reasonLabel")}{" "}
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </label>
          <input
            id="adj-reason"
            type="text"
            maxLength={200}
            value={reason}
            disabled={submitting}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            className={inputClass}
          />
        </div>

        {/* Details (optional) */}
        <div>
          <label htmlFor="adj-details" className={labelClass}>
            {t("detailsLabel")}{" "}
            <span className="text-muted-foreground text-xs font-normal">
              {t("optional")}
            </span>
          </label>
          <textarea
            id="adj-details"
            rows={3}
            maxLength={2000}
            value={details}
            disabled={submitting}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={t("detailsPlaceholder")}
            className={cn(inputClass, "h-auto resize-none py-2.5")}
          />
        </div>

        {error && (
          <AlertBanner
            variant="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}
      </div>
    </Modal>
  );
}

function TypeCard({
  active,
  onClick,
  icon: Icon,
  tone,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Gift;
  tone: "emerald" | "amber";
  label: string;
  hint: string;
}) {
  const ring =
    tone === "emerald"
      ? "border-emerald-500 bg-emerald-50 ring-emerald-500/20 dark:bg-emerald-950/30"
      : "border-amber-500 bg-amber-50 ring-amber-500/20 dark:bg-amber-950/30";
  const iconTone =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-start transition-all",
        active
          ? `${ring} ring-3`
          : "border-border hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <Icon className={cn("size-5", active ? iconTone : "text-muted-foreground")} aria-hidden />
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-muted-foreground text-xs leading-tight">{hint}</span>
    </button>
  );
}
