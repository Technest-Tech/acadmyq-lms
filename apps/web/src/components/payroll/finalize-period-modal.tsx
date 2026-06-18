"use client";

import { Loader2, Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, finalizePayoutPeriod } from "@/lib/api";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

export interface FinalizePeriodModalProps {
  open: boolean;
  defaultYear?: number;
  defaultMonth?: number;
  onClose: () => void;
  onSuccess: (finalized: number, periodLabel: string) => void;
}

/**
 * Finalizes every OPEN teacher payout for a period (Sprint 8). Finalizing seals each statement
 * immutably (it reflects money paid in the real world), so the action is gated behind an
 * explicit confirm + warning. Idempotent: a re-run for an already-finalized period finalizes 0.
 */
export function FinalizePeriodModal({
  open,
  defaultYear,
  defaultMonth,
  onClose,
  onSuccess,
}: FinalizePeriodModalProps) {
  const t = useTranslations("payroll");
  const locale = useLocale();

  const now = new Date();
  const [year, setYear] = useState<number>(defaultYear ?? now.getFullYear());
  const [month, setMonth] = useState<number>(defaultMonth ?? now.getMonth() + 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthFmt = new Intl.DateTimeFormat(locale, { month: "long" });
  const periodLabel = `${monthFmt.format(new Date(year, month - 1, 1))} ${year}`;

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await finalizePayoutPeriod(year, month);
      onSuccess(res.finalized, periodLabel);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const selectClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 h-9 w-full rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";
  const labelClass = "mb-1 block text-sm font-medium";

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("finalizeTitle")}
      size="sm"
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
            variant="destructive"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Lock className="size-3.5" aria-hidden />
            )}
            {submitting ? t("finalizing") : t("finalizeConfirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="fp-year" className={labelClass}>
              {t("year")}
            </label>
            <select
              id="fp-year"
              value={year}
              disabled={submitting}
              onChange={(e) => setYear(Number(e.target.value))}
              className={selectClass}
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fp-month" className={labelClass}>
              {t("month")}
            </label>
            <select
              id="fp-month"
              value={month}
              disabled={submitting}
              onChange={(e) => setMonth(Number(e.target.value))}
              className={selectClass}
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthFmt.format(new Date(2000, m - 1, 1))}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("finalizeDesc", { period: periodLabel })}
        </p>

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
