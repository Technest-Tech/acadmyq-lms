"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  FINANCE_METHODS,
  recordFinancePayment,
  type FinanceDealPayload,
  type FinanceDealRow,
  type FinanceMethod,
} from "@/lib/api";
import { Field, inputClass, textareaClass } from "./finance-fields";
import {
  errorMessage,
  fromMinor,
  money,
  todayIso,
  toMinor,
} from "./finance-format";

/**
 * Record money received against one deal. The amount is pre-filled with what is owed on the
 * next open installment — the common case is "he paid this one" — but any amount goes: less
 * leaves a partial, more flows into the following installments (or rolls a subscription).
 */
export function PaymentFormModal({
  open,
  deal,
  onClose,
  onSaved,
}: {
  open: boolean;
  deal: FinanceDealRow | null;
  onClose: () => void;
  onSaved: (payload: FinanceDealPayload) => void;
}) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("INSTAPAY");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !deal) return;
    setPaidOn(todayIso());
    setAmount(deal.next_due_minor > 0 ? fromMinor(deal.next_due_minor) : "");
    setMethod("INSTAPAY");
    setReference("");
    setNote("");
    setError(null);
    setSaving(false);
  }, [open, deal]);

  if (!deal) return null;

  async function save() {
    if (!deal) return;
    const minor = toMinor(amount);
    if (minor === null || minor <= 0) {
      setError(t("form.errors.payment"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = await recordFinancePayment(deal.id, {
        paid_on: paidOn,
        amount_minor: minor,
        method,
        reference: reference.trim() || null,
        note: note.trim() || null,
      });
      toast.success(t("payment.recorded"));
      onSaved(payload);
    } catch (e) {
      setError(errorMessage(e, t("form.errors.generic")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("payment.title")}
      description={t("payment.hint", {
        deal: `${deal.client_name} — ${deal.title}`,
      })}
      closeLabel={t("actions.close")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? t("actions.saving") : t("actions.recordPayment")}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("actions.cancel")}
          </Button>
          {error ? (
            <span role="alert" className="text-destructive basis-full text-xs">
              {error}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`${t("form.paidAmount")} (${deal.currency})`}
          htmlFor="fin-pay-amount"
          hint={
            deal.next_due_minor > 0
              ? t("payment.suggested", {
                  amount: money(deal.next_due_minor, deal.currency, locale),
                })
              : undefined
          }
        >
          <input
            id="fin-pay-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
            dir="ltr"
            autoFocus
          />
        </Field>
        <Field label={t("form.paidOn")} htmlFor="fin-pay-date">
          <input
            id="fin-pay-date"
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className={inputClass}
            dir="ltr"
          />
        </Field>
        <Field label={t("form.method")} htmlFor="fin-pay-method">
          <select
            id="fin-pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as FinanceMethod)}
            className={inputClass}
          >
            {FINANCE_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("form.reference")} htmlFor="fin-pay-ref">
          <input
            id="fin-pay-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("form.referencePlaceholder")}
            className={inputClass}
            dir="ltr"
          />
        </Field>
        <Field
          label={t("form.paymentNote")}
          htmlFor="fin-pay-note"
          className="sm:col-span-2"
        >
          <textarea
            id="fin-pay-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className={textareaClass}
          />
        </Field>
      </div>
    </Modal>
  );
}
