"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { SettlementFields, settledNotice } from "@/components/accounting/settle-package";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  cancelLessonPackage,
  closeLessonPackage,
  getPackageSettlement,
  type LessonPackageRow,
  type PackageSettlementInfo,
  type SettlementChoice,
  type SettlementResult,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";

/**
 * Close a package early — the packages page's own modal, shared with the student's subscriptions
 * card. Closing keeps what was used and bills it per the package's rules. `allowCancel` adds the
 * other end for a package nothing was taken from yet: cancel it, which voids its untouched bill.
 * A block paid up front with lessons left asks, in the same step, what becomes of the money paid
 * for them (SettlementFields) — or leaves it waiting on the family's account.
 */
export function ClosePackageModal({
  row,
  title,
  allowCancel = false,
  onClose,
  onDone,
  onError,
}: {
  /** The package to close; null keeps the modal shut. */
  row: LessonPackageRow | null;
  title?: string;
  allowCancel?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  /** Where a refusal is said; without it, inside the modal. */
  onError?: (message: string) => void;
}) {
  const t = useTranslations("packages");
  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title={title ?? t("close.title")}
      description={t("close.description")}
      size="sm"
    >
      {/* Mounted per opening, so the reason and the checkbox start blank every time. */}
      {row !== null && (
        <CloseBody
          row={row}
          allowCancel={allowCancel}
          onClose={onClose}
          onDone={onDone}
          onError={onError}
        />
      )}
    </Modal>
  );
}

function CloseBody({
  row,
  allowCancel,
  onClose,
  onDone,
  onError,
}: {
  row: LessonPackageRow;
  allowCancel: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (message: string) =>
    onError ? onError(message) : setError(message);
  const [closeReason, setCloseReason] = useState("");
  /**
   * Also put this student back on the monthly clock as the package closes. The only way out of
   * package billing, deliberately sited here: closing is when an owner actually decides someone
   * is done buying blocks, and keeping it on this screen is what makes /packages the whole story
   * for both directions of the switch.
   */
  const [returnToMonthly, setReturnToMonthly] = useState(false);

  const unused = row.minutes_consumed - row.absorbed_overdraft_minutes <= 0;

  // Paid for lessons it will not give: what becomes of that money (asked only of whoever handles it).
  const { can, session } = useAuth();
  // Settling a prepaid block is a centre's: a Quran academy's close dialog is unchanged (no request).
  const centre = session?.capabilities?.includes("centre") ?? false;
  const ta = useTranslations("accounting");
  const [settle, setSettle] = useState<PackageSettlementInfo | null>(null);
  const [choice, setChoice] = useState<SettlementChoice | null>({ mode: "CREDIT" });
  const asksSettlement = settle?.preview != null && settle.can_settle && settle.preview.owed_back_minor > 0;
  useEffect(() => {
    if (!centre || row.bill_timing !== "ON_START" || !can("invoice.read")) return;
    let live = true;
    getPackageSettlement(row.id)
      .then((info) => live && setSettle(info))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [row.id, row.bill_timing, can, centre]);
  const settledText = (s: SettlementResult | null | undefined) =>
    s ? ` ${settledNotice(ta, s.mode, formatMoney({ amount: s.amount_minor, currency: s.currency }, locale), s.expense_number)}` : "";
  const chosen = asksSettlement ? (choice ?? undefined) : undefined;
  const choiceIncomplete = chosen?.mode === "REFUND" && !chosen.cash_account_id;

  async function confirmClose(target: LessonPackageRow) {
    setBusy(true);
    try {
      const result = await closeLessonPackage(
        target.id,
        closeReason.trim() || undefined,
        returnToMonthly,
        chosen,
      );
      onDone(
        (result.returned_to_monthly
          ? t("alerts.closedAndReturned")
          : t("alerts.closed")) + settledText(result.settlement),
      );
    } catch {
      fail(t("alerts.closeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel(target: LessonPackageRow) {
    setBusy(true);
    try {
      const result = await cancelLessonPackage(target.id, closeReason.trim() || undefined, chosen);
      onDone(t("alerts.cancelled") + settledText(result.settlement));
    } catch {
      fail(t("alerts.cancelFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      <p className="text-muted-foreground text-sm">
        {t("close.remaining", {
          left: formatHours(row.minutes_remaining, locale),
        })}
      </p>
      {asksSettlement && settle.preview && (
        <SettlementFields
          preview={settle.preview}
          accounts={settle.accounts}
          canRefund={settle.can_refund}
          value={choice}
          onChange={setChoice}
          allowLater
        />
      )}
      {row.bill_timing === "ON_COMPLETION" && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {t("close.proRataNote")}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="pkg-close-reason" className="text-sm font-medium">
          {t("close.reason")}
        </label>
        <input
          id="pkg-close-reason"
          value={closeReason}
          onChange={(e) => setCloseReason(e.target.value)}
          placeholder={t("close.reasonPlaceholder")}
          className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
        />
      </div>

      {/* The way back to the monthly clock. Off by default: most closes are followed by the
              next block, and silently moving someone between billing modes is the behaviour this
              screen exists to stop. */}
      <label
        className="border-input hover:bg-muted/30 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors"
        data-testid="return-to-monthly"
      >
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0"
          checked={returnToMonthly}
          onChange={(e) => setReturnToMonthly(e.target.checked)}
        />
        <span>
          <span className="block font-medium">
            {t("close.returnToMonthly", { name: row.student_name })}
          </span>
          <span className="text-muted-foreground/80 block text-[11px]">
            {t("close.returnToMonthlyHint")}
          </span>
        </span>
      </label>
      {allowCancel && unused && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-3 py-2.5"
          data-testid="pkg-cancel-instead"
        >
          <p className="text-muted-foreground min-w-0 flex-1 text-xs">
            {t("close.cancelHint")}
          </p>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void confirmCancel(row)}
            disabled={busy || choiceIncomplete}
            data-testid="pkg-cancel-confirm"
          >
            {t("close.cancelConfirm")}
          </Button>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t("actions.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={() => void confirmClose(row)}
          disabled={busy || choiceIncomplete}
          data-testid="pkg-close-confirm"
        >
          {t("close.confirm")}
        </Button>
      </div>
    </div>
  );
}
