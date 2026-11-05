"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { todayLocal } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RECEIPT_METHODS, amendReceipt, type ReceiptDetail, type ReceiptMethod } from "@/lib/accounting-api";

const fieldClass = "border-input bg-background mt-1 h-10 w-full rounded-xl border px-3 text-sm";

/**
 * Correct a receipt typed wrong (Lingo: "cash" that came by InstaPay, the wrong day): its method,
 * day, reference and note. The amount and what it paid never move — a wrong amount is a void and a
 * new receipt. A card or carried-over receipt keeps its method and day.
 */
export function AmendReceiptForm({
  receipt,
  onSaved,
  onCancel,
}: {
  receipt: ReceiptDetail;
  onSaved: (receipt: ReceiptDetail) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("accounting");
  const [method, setMethod] = useState<ReceiptMethod>(receipt.method);
  const [receivedOn, setReceivedOn] = useState(receipt.received_on);
  const [reference, setReference] = useState(receipt.reference ?? "");
  const [note, setNote] = useState(receipt.note ?? "");
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desk = receipt.source === "MANUAL";
  // A new non-cash method needs the transfer picture, unless one is already on file.
  const needsProof = method !== "CASH" && method !== receipt.method && !receipt.has_proof;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await amendReceipt(receipt.id, { method, received_on: receivedOn, reference, note, proof });
      onSaved(res.receipt);
    } catch (err) {
      setError(apiErrorMessage(err, t("amend.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border p-3" data-testid="amend-receipt">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t("collect.method")}
          <select className={fieldClass} value={method} disabled={!desk} onChange={(e) => setMethod(e.target.value as ReceiptMethod)} data-testid="amend-method">
            {RECEIPT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t("collect.receivedOn")}
          <input type="date" className={fieldClass} value={receivedOn} max={todayLocal()} disabled={!desk} onChange={(e) => setReceivedOn(e.target.value)} data-testid="amend-date" />
        </label>
        <label className="block text-sm font-medium">
          {t("collect.reference")}
          <input className={fieldClass} dir="ltr" value={reference} maxLength={255} onChange={(e) => setReference(e.target.value)} data-testid="amend-reference" />
        </label>
        <label className="block text-sm font-medium">
          {t("collect.note")}
          <input className={fieldClass} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} data-testid="amend-note" />
        </label>
      </div>
      {method !== "CASH" && method !== receipt.method && (
        <label className="block text-sm font-medium">
          {t("collect.proof")}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" onChange={(e) => setProof(e.target.files?.[0] ?? null)} data-testid="amend-proof" />
        </label>
      )}
      <p className="text-muted-foreground text-xs">{desk ? t("amend.hint") : t("amend.historyHint")}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("collect.cancel")}
        </Button>
        <Button type="button" onClick={() => void save()} disabled={busy || receivedOn === "" || (needsProof && proof === null)} className="gap-1.5" data-testid="amend-save">
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("amend.save")}
        </Button>
      </div>
    </div>
  );
}
