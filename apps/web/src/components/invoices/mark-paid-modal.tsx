"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

// ── Types ──────────────────────────────────────────────────────────────────────

type PaymentMethod = "CASH" | "BANK_TRANSFER" | "OTHER";

interface MarkPaidPayload {
  payment_method: PaymentMethod;
  payment_reason?: string;
  amount_paid_minor?: number;
}

interface MarkPaidResult {
  ok: boolean;
  status: string;
  amount_paid_minor: number;
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface MarkPaidModalProps {
  open: boolean;
  invoiceId: string;
  totalMinor: number;
  currency: string;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Records an outside-system payment against a CLOSED invoice (Sprint 7).
 * Submits POST /api/invoices/{id}/mark-paid. When amount_paid_minor < total
 * the API transitions status → PARTIALLY_PAID; equal/greater → PAID.
 */
export function MarkPaidModal({
  open,
  invoiceId,
  totalMinor,
  currency,
  onClose,
  onSuccess,
}: MarkPaidModalProps) {
  const t = useTranslations("invoices");
  const locale = useLocale();

  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reason, setReason] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive minor units from the optional partial-amount input (major units entered).
  const amountMajorFloat = amountInput === "" ? NaN : parseFloat(amountInput);
  const amountMinorParsed = Number.isFinite(amountMajorFloat)
    ? Math.round(amountMajorFloat * 100)
    : null;

  const isPartial =
    amountMinorParsed !== null && amountMinorParsed < totalMinor;

  const willBeStatus = isPartial ? "PARTIALLY_PAID" : "PAID";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: MarkPaidPayload = {
        payment_method: method,
        ...(reason.trim() ? { payment_reason: reason.trim() } : {}),
        ...(amountMinorParsed !== null
          ? { amount_paid_minor: amountMinorParsed }
          : {}),
      };
      await apiFetch<MarkPaidResult>(
        `/api/invoices/${invoiceId}/mark-paid`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return;
    setError(null);
    setMethod("CASH");
    setReason("");
    setAmountInput("");
    onClose();
  }

  const inputClass =
    "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

  const labelClass = "mb-1 block text-sm font-medium";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("markPaidTitle")}
      description={formatMoney({ amount: totalMinor, currency }, locale)}
      size="sm"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="mark-paid-form"
            size="sm"
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {submitting ? t("saving") : t("confirmMarkPaid")}
          </Button>
        </>
      }
    >
      <form
        id="mark-paid-form"
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-4"
        noValidate
      >
        {/* Payment method */}
        <div>
          <label htmlFor="mp-method" className={labelClass}>
            {t("paymentMethod")}
          </label>
          <select
            id="mp-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            disabled={submitting}
            className={inputClass}
            required
          >
            <option value="CASH">{t("methodCash")}</option>
            <option value="BANK_TRANSFER">{t("methodBankTransfer")}</option>
            <option value="OTHER">{t("methodOther")}</option>
          </select>
        </div>

        {/* Optional partial amount */}
        <div>
          <label htmlFor="mp-amount" className={labelClass}>
            {t("amountPaidLabel")}{" "}
            <span className="text-muted-foreground font-normal">
              ({t("amountPaidHint")})
            </span>
          </label>
          <input
            id="mp-amount"
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            placeholder={formatMoney({ amount: totalMinor, currency }, locale)}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            disabled={submitting}
            className={inputClass}
          />
          {/* Warn when partial */}
          {isPartial && (
            <p className="text-muted-foreground mt-1 text-xs">
              {t("partialWarning", {
                status: t(`status.${willBeStatus}`),
              })}
            </p>
          )}
        </div>

        {/* Optional payment reason / notes */}
        <div>
          <label htmlFor="mp-reason" className={labelClass}>
            {t("paymentReason")}{" "}
            <span className="text-muted-foreground font-normal">
              ({t("optional")})
            </span>
          </label>
          <textarea
            id="mp-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
            className={inputClass}
            placeholder={t("paymentReasonPlaceholder")}
          />
        </div>

        {error && (
          <AlertBanner
            variant="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}
      </form>
    </Modal>
  );
}
