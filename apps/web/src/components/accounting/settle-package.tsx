"use client";

import { Banknote, Clock, Landmark, Loader2, PiggyBank } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toMajorText, toMinor } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { lessonsIn } from "@/components/packages/lesson-price-fields";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { refundFamilyCredit, type UnsettledPackage } from "@/lib/accounting-api";
import { settlePackage, type SettlementChoice, type SettlementMode, type SettlementPreview } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

type Account = { id: string; name: string };

/**
 * What becomes of the lessons a family paid for and never had (docs/groups/01-ACCOUNTING.md, "A
 * subscription that ends early"): the family's credit, paid back out of a treasury account, or kept
 * by the academy with why. In the close dialog (`allowLater`: decide later — the family's account
 * then shows it waiting) and in {@see SettleModal}.
 */
export function SettlementFields({
  preview,
  accounts,
  canRefund,
  value,
  onChange,
  allowLater = false,
}: {
  preview: SettlementPreview;
  accounts: Account[];
  canRefund: boolean;
  /** null = decide later. */
  value: SettlementChoice | null;
  onChange: (next: SettlementChoice | null) => void;
  allowLater?: boolean;
}) {
  const t = useTranslations("accounting");
  const tp = useTranslations("packages");
  const locale = useLocale();
  const money = (amount: number) => formatMoney({ amount, currency: preview.currency }, locale);
  const left = preview.lesson_minutes ? tp("card.lessonsCount", { count: lessonsIn(preview.unused_minutes, preview.lesson_minutes) }) : formatHours(preview.unused_minutes, locale);
  const modes: { mode: SettlementMode | null; icon: typeof PiggyBank; disabled?: boolean }[] = [
    { mode: "CREDIT", icon: PiggyBank },
    { mode: "REFUND", icon: Banknote, disabled: !canRefund || accounts.length === 0 },
    { mode: "KEEP", icon: Landmark },
    ...(allowLater ? [{ mode: null, icon: Clock }] : []),
  ];
  const pick = (mode: SettlementMode | null) =>
    onChange(mode === null ? null : { mode, cash_account_id: mode === "REFUND" ? (value?.cash_account_id ?? accounts[0]?.id ?? null) : null, note: value?.note ?? null });

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3" data-testid="settlement-fields">
      <div>
        <p className="text-sm font-semibold">{t("settle.owedBack", { amount: money(preview.owed_back_minor) })}</p>
        <p className="text-muted-foreground text-xs">
          {t("settle.breakdown", { left, paid: money(preview.paid_minor), used: money(preview.used_minor) })}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label={t("settle.title")}>
        {modes.map(({ mode, icon: Icon, disabled }) => {
          const key = mode ?? "LATER";
          const checked = (value?.mode ?? null) === mode;
          return (
            <label
              key={key}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                checked ? "border-primary bg-primary/5" : "hover:bg-muted/30",
                disabled && "cursor-not-allowed opacity-50",
              )}
              data-testid={`settle-mode-${key}`}
            >
              <input type="radio" className="mt-0.5 size-4 shrink-0" checked={checked} disabled={disabled} onChange={() => pick(mode)} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {t(`settle.mode.${key}`)}
                </span>
                <span className="text-muted-foreground block text-[11px]">
                  {mode === "REFUND" && disabled ? t("settle.noAccount") : t(`settle.hint.${key}`)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {value?.mode === "REFUND" && (
        <select
          className={fieldClass}
          value={value.cash_account_id ?? ""}
          onChange={(e) => onChange({ ...value, cash_account_id: e.target.value })}
          aria-label={t("settle.account")}
          data-testid="settle-account"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      {value !== null && (
        <input
          className={fieldClass}
          value={value.note ?? ""}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          placeholder={t(value.mode === "KEEP" ? "settle.keepReason" : "settle.note")}
          maxLength={500}
          data-testid="settle-note"
        />
      )}
    </div>
  );
}

/** What the settlement did, for the notice. */
export function settledNotice(t: ReturnType<typeof useTranslations>, mode: SettlementMode, amount: string, expense?: string | null): string {
  if (mode === "REFUND") return t("settle.done.REFUND", { amount, number: expense ?? "" });
  return t(`settle.done.${mode}`, { amount });
}

/** Decide, later, for a subscription that closed waiting on it (from the family's account). */
export function SettleModal({
  item,
  accounts,
  canRefund,
  onClose,
  onDone,
}: {
  item: UnsettledPackage | null;
  accounts: Account[];
  canRefund: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("accounting");
  return (
    <Modal open={item !== null} onClose={onClose} title={t("settle.title")} description={item ? t("settle.for", { name: item.student_name, label: item.label }) : undefined} size="sm">
      {item !== null && <SettleBody item={item} accounts={accounts} canRefund={canRefund} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function SettleBody({ item, accounts, canRefund, onClose, onDone }: { item: UnsettledPackage; accounts: Account[]; canRefund: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [choice, setChoice] = useState<SettlementChoice | null>({ mode: "CREDIT" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (choice === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await settlePackage(item.package_id, choice);
      onDone(settledNotice(t, res.mode, formatMoney({ amount: res.amount_minor, currency: res.currency }, locale), res.expense_number));
    } catch (err) {
      setError(apiErrorMessage(err, t("settle.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <SettlementFields preview={item} accounts={accounts} canRefund={canRefund} value={choice} onChange={setChoice} />
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t("settle.back")}
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => void confirm()} disabled={busy || choice === null || (choice.mode === "REFUND" && !choice.cash_account_id)} data-testid="settle-confirm">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("settle.confirm")}
        </Button>
      </div>
    </div>
  );
}

/** Pay a family's credit back out of a treasury account. */
export function RefundCreditModal({
  guardianId,
  credit,
  accounts,
  onClose,
  onDone,
}: {
  guardianId: string;
  /** The credit to pay back from (one currency); null keeps the modal shut. */
  credit: { currency: string; credit_minor: number } | null;
  accounts: { id: string; name: string; currency: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("accounting");
  return (
    <Modal open={credit !== null} onClose={onClose} title={t("family.refund.title")} description={t("family.refund.description")} size="sm">
      {credit !== null && (
        <RefundBody guardianId={guardianId} credit={credit} accounts={accounts.filter((a) => a.currency === credit.currency)} onClose={onClose} onDone={onDone} />
      )}
    </Modal>
  );
}

function RefundBody({
  guardianId,
  credit,
  accounts,
  onClose,
  onDone,
}: {
  guardianId: string;
  credit: { currency: string; credit_minor: number };
  accounts: Account[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [amount, setAmount] = useState(toMajorText(credit.credit_minor));
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = toMinor(amount);
  const valid = minor > 0 && minor <= credit.credit_minor && accountId !== "";

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await refundFamilyCredit(guardianId, { amount_minor: minor, currency: credit.currency, cash_account_id: accountId, note: note.trim() || null });
      onDone(t("settle.done.REFUND", { amount: formatMoney({ amount: minor, currency: credit.currency }, locale), number: res.number }));
    } catch (err) {
      setError(apiErrorMessage(err, t("family.refund.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <p className="text-muted-foreground text-sm">{t("family.refund.holds", { amount: formatMoney({ amount: credit.credit_minor, currency: credit.currency }, locale) })}</p>
      {accounts.length === 0 ? (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">{t("settle.noAccount")}</p>
      ) : (
        <>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{t("family.refund.amount")}</span>
            <input className={fieldClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="refund-amount" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{t("settle.account")}</span>
            <select className={fieldClass} value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="refund-account">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("settle.note")} maxLength={500} />
        </>
      )}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t("settle.back")}
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => void confirm()} disabled={busy || !valid} data-testid="refund-confirm">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("family.refund.confirm")}
        </Button>
      </div>
    </div>
  );
}
