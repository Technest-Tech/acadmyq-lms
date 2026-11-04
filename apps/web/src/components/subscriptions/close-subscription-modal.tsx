"use client";

import { Banknote, Clock, Landmark, Loader2, PiggyBank } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { RECEIPT_METHODS } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import {
  cancelSubscription,
  closeSubscription,
  getSubscriptionSettlement,
  type CloseInput,
  type SubscriptionRefund,
  type SubscriptionRow,
  type SubscriptionSettlementMode,
  type SubscriptionSettlementPreview,
} from "@/lib/subscriptions-api";
import { cn } from "@/lib/utils";

/** The desk's answer on the money paid for lessons never taken; null = decide later (PENDING). */
export interface SettlementChoice {
  mode: SubscriptionSettlementMode;
  refund: SubscriptionRefund;
}

/**
 * What becomes of the lessons a family paid for and never had (docs/centre-profile/01 rule 2,
 * the ported PackageSettlement rules): the family's credit, paid back (how, with a reference), or
 * kept by the academy with why. In the close dialog (`allowLater`: the family's account then shows
 * it waiting) and on the family's account for one closed that way.
 */
export function SubscriptionSettlementFields({
  preview,
  value,
  onChange,
  allowLater = false,
}: {
  preview: SubscriptionSettlementPreview;
  value: SettlementChoice | null;
  onChange: (next: SettlementChoice | null) => void;
  allowLater?: boolean;
}) {
  const t = useTranslations("subscriptions.settle");
  const tm = useTranslations("accounting.receipts.method");
  const locale = useLocale();
  const money = (amount: number) => formatMoney({ amount, currency: preview.currency }, locale);
  const modes: { mode: SubscriptionSettlementMode | null; icon: typeof PiggyBank; disabled?: boolean }[] = [
    { mode: "CREDIT", icon: PiggyBank },
    { mode: "REFUND", icon: Banknote, disabled: !preview.can_refund },
    { mode: "KEEP", icon: Landmark },
    ...(allowLater ? [{ mode: null, icon: Clock }] : []),
  ];
  const pick = (mode: SubscriptionSettlementMode | null) =>
    onChange(mode === null ? null : { mode, refund: value?.refund ?? { method: "CASH", reference: "", note: "" } });

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3" data-testid="subscription-settlement">
      <div>
        <p className="text-sm font-semibold">{t("owedBack", { amount: money(preview.owed_back_minor) })}</p>
        <p className="text-muted-foreground text-xs">{t("breakdown", { paid: money(preview.paid_minor), used: money(preview.used_value_minor) })}</p>
      </div>
      <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label={t("title")}>
        {modes.map(({ mode, icon: Icon, disabled }) => {
          const key = mode ?? "LATER";
          const checked = (value?.mode ?? null) === mode;
          return (
            <label
              key={key}
              className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors", checked ? "border-primary bg-primary/5" : "hover:bg-muted/30", disabled && "cursor-not-allowed opacity-50")}
              data-testid={`subscription-settle-${key}`}
            >
              <input type="radio" className="mt-0.5 size-4 shrink-0" checked={checked} disabled={disabled} onChange={() => pick(mode)} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {t(`mode.${key}`)}
                </span>
                <span className="text-muted-foreground block text-[11px]">{mode === "REFUND" && disabled ? t("noRefund") : t(`hint.${key}`)}</span>
              </span>
            </label>
          );
        })}
      </div>
      {value?.mode === "REFUND" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select className={fieldClass} value={value.refund.method} onChange={(e) => onChange({ ...value, refund: { ...value.refund, method: e.target.value } })} aria-label={t("method")} data-testid="subscription-refund-method">
            {RECEIPT_METHODS.map((m) => (
              <option key={m} value={m}>
                {tm(m)}
              </option>
            ))}
          </select>
          <input className={fieldClass} value={value.refund.reference ?? ""} onChange={(e) => onChange({ ...value, refund: { ...value.refund, reference: e.target.value } })} placeholder={t("reference")} maxLength={120} data-testid="subscription-refund-reference" />
        </div>
      )}
      {value !== null && (
        <input className={fieldClass} value={value.refund.note ?? ""} onChange={(e) => onChange({ ...value, refund: { ...value.refund, note: e.target.value } })} placeholder={t(value.mode === "KEEP" ? "keepReason" : "note")} maxLength={500} data-testid="subscription-settle-note" />
      )}
    </div>
  );
}

/** The close body, as the API takes it. */
export function settlementInput(choice: SettlementChoice | null): Pick<CloseInput, "settlement" | "refund" | "settlement_note"> {
  if (choice === null) return {};
  const note = choice.refund.note?.trim() || null;
  if (choice.mode === "REFUND") return { settlement: "REFUND", refund: { method: choice.refund.method, reference: choice.refund.reference?.trim() || null, note } };
  return { settlement: choice.mode, ...(note ? { settlement_note: note } : {}) };
}

/** What the settlement did, for the notice. */
export function settledNotice(t: (key: string, values?: Record<string, string | number>) => string, mode: SubscriptionSettlementMode, amount: string, expense?: string | null): string {
  return t(`done.${mode}`, { amount, number: expense ?? "" });
}

/**
 * Close a block early — the subscriptions page's own modal, shared with the student's card. Closing
 * keeps what was used; a block paid up front with lessons left asks, in the same step, what becomes
 * of the money paid for them. A block nothing happened on yet (`deletable`) offers cancelling
 * instead, which voids its bill line.
 */
export function CloseSubscriptionModal({
  row,
  title,
  onClose,
  onDone,
}: {
  /** The subscription to close; null keeps the modal shut. */
  row: SubscriptionRow | null;
  title?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("subscriptions.close");
  return (
    <Modal open={row !== null} onClose={onClose} title={title ?? t("title")} description={t("description")} size="sm">
      {/* Mounted per opening, so the reason and the choice start blank every time. */}
      {row !== null && <CloseBody row={row} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function CloseBody({ row, onClose, onDone }: { row: SubscriptionRow; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("subscriptions.close");
  const ts = useTranslations("subscriptions.settle");
  const locale = useLocale();
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<SubscriptionSettlementPreview | null>(null);
  const [choice, setChoice] = useState<SettlementChoice | null>({ mode: "CREDIT", refund: { method: "CASH", reference: "", note: "" } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asks = preview !== null && preview.owed_back_minor > 0;

  useEffect(() => {
    let live = true;
    getSubscriptionSettlement(row.id)
      .then((p) => live && setPreview(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [row.id]);

  async function confirmClose() {
    setBusy(true);
    setError(null);
    try {
      const res = await closeSubscription(row.id, { reason: reason.trim(), ...(asks ? settlementInput(choice) : {}) });
      const settled = res.settlement ? ` ${settledNotice(ts, res.settlement.mode, formatMoney({ amount: res.settlement.amount_minor, currency: res.settlement.currency }, locale), res.settlement.expense_number)}` : "";
      onDone(t("closed") + settled);
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
      setBusy(false);
    }
  }

  async function confirmCancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelSubscription(row.id, reason.trim() || undefined);
      onDone(t("cancelled"));
    } catch (err) {
      setError(apiErrorMessage(err, t("cancelFailed")));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <p className="text-muted-foreground text-sm">{t("remaining", { left: row.lessons_left, sold: row.lessons_sold })}</p>
      {asks && preview && <SubscriptionSettlementFields preview={preview} value={choice} onChange={setChoice} allowLater />}
      <label className="block space-y-1.5 text-sm font-medium">
        <span>{t("reason")}</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPlaceholder")} className={fieldClass} maxLength={200} data-testid="close-reason" />
      </label>
      {row.deletable && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-3 py-2.5" data-testid="close-cancel-instead">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs">{t("cancelHint")}</p>
          <Button size="xs" variant="outline" onClick={() => void confirmCancel()} disabled={busy} data-testid="close-cancel-confirm">
            {t("cancelConfirm")}
          </Button>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t("back")}
        </Button>
        <Button size="sm" onClick={() => void confirmClose()} disabled={busy || reason.trim() === ""} className="gap-1.5" data-testid="close-confirm">
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("confirm")}
        </Button>
      </div>
    </div>
  );
}
