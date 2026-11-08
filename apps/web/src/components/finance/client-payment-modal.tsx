"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  FINANCE_CURRENCIES,
  FINANCE_METHODS,
  receiveFromClient,
  type AccountPayload,
  type FinanceClientRow,
  type FinanceMethod,
} from "@/lib/api";
import { Field, inputClass, textareaClass } from "./finance-fields";
import { errorMessage, fromMinor, money, todayIso, toMinor } from "./finance-format";

/** What the dialog needs to know about the payer — an account row, or one assembled from its dues. */
export type PayerFacts = Pick<
  FinanceClientRow,
  | "id"
  | "name"
  | "academy_name"
  | "overdue"
  | "outstanding"
  | "has_overdue"
  | "next_due_on"
  | "next_due_minor"
  | "next_due_currency"
  | "rec_currency"
>;

/**
 * "He paid" — money received from a client, not from one line. The book pays the client's oldest
 * dues first across every active line in that currency, and anything beyond pays the recurring
 * line ahead (which rolls its cycles). The amount starts at what is owed now: everything late plus
 * the next due.
 */
export function ClientPaymentModal({
  open,
  account,
  onClose,
  onSaved,
}: {
  open: boolean;
  account: PayerFacts | null;
  onClose: () => void;
  onSaved: (payload: AccountPayload) => void;
}) {
  const t = useTranslations("finance");
  const ta = useTranslations("accounts.panel");
  const locale = useLocale();
  const toast = useToast();
  const [currency, setCurrency] = useState("EGP");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("INSTAPAY");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestion = (a: PayerFacts, c: string): number =>
    (a.overdue[c] ?? 0) + (a.next_due_currency === c && a.next_due_on && !a.has_overdue ? (a.next_due_minor ?? 0) : 0);

  useEffect(() => {
    if (!open || !account) return;
    const c = account.next_due_currency ?? account.rec_currency ?? Object.keys(account.outstanding)[0] ?? "EGP";
    setCurrency(c);
    const s = suggestion(account, c);
    setAmount(s > 0 ? fromMinor(s) : "");
    setPaidOn(todayIso());
    setMethod("INSTAPAY");
    setReference("");
    setNote("");
    setError(null);
    setSaving(false);
  }, [open, account]);

  if (!account) return null;
  const suggested = suggestion(account, currency);

  async function save() {
    if (!account) return;
    const minor = toMinor(amount);
    if (minor === null || minor <= 0) {
      setError(t("form.errors.payment"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = await receiveFromClient(account.id, {
        currency,
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
      description={ta("receiveHint", { name: account.academy_name ?? account.name })}
      closeLabel={t("actions.close")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving} data-testid="client-payment-save">
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t("form.paidAmount")}
          htmlFor="acct-pay-amount"
          hint={suggested > 0 ? ta("owedNow", { amount: money(suggested, currency, locale) }) : undefined}
        >
          <div className="flex gap-2">
            <input
              id="acct-pay-amount"
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
            <select
              aria-label={t("form.currency")}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`${inputClass} w-24 shrink-0`}
            >
              {FINANCE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label={t("form.paidOn")} htmlFor="acct-pay-date">
          <input id="acct-pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} dir="ltr" />
        </Field>
        <Field label={t("form.method")} htmlFor="acct-pay-method">
          <select id="acct-pay-method" value={method} onChange={(e) => setMethod(e.target.value as FinanceMethod)} className={inputClass}>
            {FINANCE_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("form.reference")} htmlFor="acct-pay-ref">
          <input
            id="acct-pay-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t("form.referencePlaceholder")}
            className={inputClass}
            dir="ltr"
          />
        </Field>
        <Field label={t("form.paymentNote")} htmlFor="acct-pay-note" className="sm:col-span-2">
          <textarea id="acct-pay-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={textareaClass} />
        </Field>
      </div>
    </Modal>
  );
}
