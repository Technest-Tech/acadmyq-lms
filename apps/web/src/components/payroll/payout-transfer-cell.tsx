"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ApiError, setPayoutTransferred, type PayoutRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";

export type TransferState = "DONE" | "TREASURY" | "PENDING" | "NOTHING_DUE";

/** Where a statement's money stands. The server's `transfer` filter draws the same lines. */
export function transferState(row: PayoutRow): TransferState {
  if (row.transferred_at) return "DONE";
  const paid = row.paid_out_minor ?? 0;
  if (paid > 0 && paid >= row.total_minor) return "TREASURY";
  return row.total_minor > 0 ? "PENDING" : "NOTHING_DUE";
}

/**
 * "Transferred" beside a month's salary, so the office can see who has been paid and who has not.
 * A note, not a payment: it moves no money and leaves the statement correctable, so a correction made
 * after the tick shows the difference here rather than locking the statement.
 */
export function PayoutTransferCell({
  row,
  canMark,
  onChanged,
}: {
  row: PayoutRow;
  canMark: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = transferState(row);
  const money = (amount: number) => formatMoney({ amount, currency: row.currency }, locale);

  // Hold the new position until the reloaded row arrives, so the switch does not flick back.
  useEffect(() => setPending(null), [row.transferred_at]);

  if (state === "NOTHING_DUE") return <span className="text-muted-foreground">—</span>;

  if (state === "TREASURY") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <Check className="size-3.5" aria-hidden />
        {t("transferTreasury")}
      </span>
    );
  }

  const done = state === "DONE";
  const checked = pending ?? done;

  async function toggle(next: boolean) {
    setPending(next);
    setError(null);
    try {
      await setPayoutTransferred(row.id, next);
      onChanged();
    } catch (err) {
      setPending(null);
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const sent = row.transferred_minor ?? null;
  const when = row.transferred_at
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(row.transferred_at))
    : null;
  const paid = row.paid_out_minor ?? 0;

  return (
    // The row opens the statement, so neither a click nor Space on the switch may reach it.
    <div
      className="flex flex-col items-start gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-2">
        <Switch
          checked={checked}
          disabled={!canMark || pending !== null}
          aria-label={t("transferMark", { name: row.teacher_name ?? "—" })}
          onChange={(e) => void toggle(e.target.checked)}
          data-testid={`transfer-${row.id}`}
        />
        <span className={checked ? "text-xs font-medium" : "text-muted-foreground text-xs"}>
          {t(checked ? "transferDone" : "transferPending")}
        </span>
      </label>
      {done && when !== null && (
        <span className="text-muted-foreground text-[11px]">
          {[when, row.transferred_by_name].filter(Boolean).join(" · ")}
        </span>
      )}
      {done && sent !== null && sent !== row.total_minor && (
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400" data-testid={`transfer-differs-${row.id}`}>
          {t("transferDiffers", { sent: money(sent), total: money(row.total_minor) })}
        </span>
      )}
      {paid > 0 && (
        <span className="text-muted-foreground text-[11px]">
          {t("transferTreasuryPart", { amount: money(paid) })}
        </span>
      )}
      {error !== null && <span className="text-destructive text-[11px]">{error}</span>}
    </div>
  );
}
