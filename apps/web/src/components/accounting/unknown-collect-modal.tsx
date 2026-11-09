"use client";

import { HelpCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { METHOD_ICON, toMinor, todayLocal } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAcademyDefaults } from "@/lib/academy-defaults";
import { RECEIPT_METHODS, recordReceipt, type ReceiptDetail, type ReceiptMethod } from "@/lib/accounting-api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 h-10 w-full rounded-xl border px-3 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";
const labelClass = "mb-1.5 block text-sm font-medium";

/**
 * Money that arrived before anyone said whose (lingo, 2026-11-09): a transfer lands, the parent has
 * not sent the receipt yet. It is recorded under "unknown" — in the treasury, paying nothing — and
 * assigned to the family from its receipt once they write (ReceiptDetailModal → "Set the payer").
 */
export function UnknownCollectModal({ open, onClose, onRecorded }: { open: boolean; onClose: () => void; onRecorded?: (receipt: ReceiptDetail) => void }) {
  const t = useTranslations("accounting");
  const defaults = useAcademyDefaults();
  const [amountText, setAmountText] = useState("");
  const [currency, setCurrency] = useState(defaults.currency);
  const [method, setMethod] = useState<ReceiptMethod>("INSTAPAY");
  const [receivedOn, setReceivedOn] = useState(todayLocal());
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmountText("");
    setCurrency(defaults.currency);
    setMethod("INSTAPAY");
    setReceivedOn(todayLocal());
    setReference("");
    setProof(null);
    setNote("");
    setError(null);
  }, [open, defaults.currency]);

  const amount = toMinor(amountText);
  const ready = amount > 0 && currency.trim().length === 3 && (method === "CASH" || proof !== null);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await recordReceipt({ unknown_payer: true, amount_minor: amount, currency: currency.toUpperCase(), method, reference, note, received_on: receivedOn, proof });
      onRecorded?.(res.receipt);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t("collect.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t("unknown.title")}
      description={t("unknown.hint")}
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("collect.cancel")}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !ready} className="gap-1.5" data-testid="unknown-submit">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <HelpCircle className="size-4" aria-hidden />}
            {t("unknown.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="unknown-collect">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="unknown-amount" className={labelClass}>
              {t("collect.amount", { currency })}
            </label>
            <input id="unknown-amount" type="text" inputMode="decimal" dir="ltr" className={cn(inputClass, "text-lg font-semibold tabular-nums")} value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0" data-testid="unknown-amount" />
          </div>
          <div>
            <label htmlFor="unknown-currency" className={labelClass}>
              {t("collect.currency")}
            </label>
            <input id="unknown-currency" type="text" dir="ltr" maxLength={3} className={cn(inputClass, "uppercase")} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
        </div>
        <div>
          <label htmlFor="unknown-date" className={labelClass}>
            {t("collect.receivedOn")}
          </label>
          <input id="unknown-date" type="date" className={inputClass} value={receivedOn} max={todayLocal()} onChange={(e) => setReceivedOn(e.target.value)} />
        </div>
        <fieldset>
          <legend className={labelClass}>{t("collect.method")}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
            {RECEIPT_METHODS.map((m) => {
              const Icon = METHOD_ICON[m];
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={m === method}
                  onClick={() => setMethod(m)}
                  className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors", m === method ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
                  data-testid={`unknown-method-${m}`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{t(`method.${m}`)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {method !== "CASH" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="unknown-ref" className={labelClass}>
                {t("collect.reference")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
              </label>
              <input id="unknown-ref" type="text" dir="ltr" maxLength={255} className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("collect.referenceHint")} />
            </div>
            <div>
              <label htmlFor="unknown-proof" className={labelClass}>
                {t("collect.proof")} <span className="text-destructive font-normal">({t("collect.required")})</span>
              </label>
              <input id="unknown-proof" type="file" accept="image/jpeg,image/png,image/webp" className={cn(inputClass, "py-1.5")} onChange={(e) => setProof(e.target.files?.[0] ?? null)} data-testid="unknown-proof" />
            </div>
          </div>
        )}
        <div>
          <label htmlFor="unknown-note" className={labelClass}>
            {t("collect.note")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
          </label>
          <input id="unknown-note" type="text" maxLength={1000} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("unknown.notePlaceholder")} />
        </div>
      </div>
    </Modal>
  );
}
