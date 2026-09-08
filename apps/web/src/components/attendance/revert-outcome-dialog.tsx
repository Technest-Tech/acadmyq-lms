"use client";

import { AlertTriangle, Loader2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { revertAttendance } from "@/lib/api";

/**
 * Undo a recorded outcome, putting the lesson back to pending.
 *
 * Confirmed rather than one-click because it is not only a status change: the invoice line the
 * lesson created (or the package minutes it ate) comes off, and the teacher's payout accrual is
 * reversed. The dialog names those consequences up front, because "revert" on its own reads like
 * a display-only correction — and names the reason the academy usually wants it, which is that a
 * lesson can only be rescheduled while it is pending.
 *
 * When the money has already been settled — a closed invoice, a finalized payout — the server
 * refuses and its message is shown here rather than as a toast that outlives the dialog.
 */
export function RevertOutcomeDialog({
  sessionId,
  studentName,
  currentStatus,
  billed,
  open,
  onClose,
  onReverted,
}: {
  sessionId: string;
  studentName?: string | null;
  /** The outcome being taken back, for the confirmation line. */
  currentStatus: string;
  /** Whether this lesson currently carries a charge — the extra warning is only true when it does. */
  billed?: boolean;
  open: boolean;
  onClose: () => void;
  onReverted: () => void;
}) {
  const t = useTranslations("attendance.revert");
  const tStatus = useTranslations("scheduling.status");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await revertAttendance(sessionId);
      onReverted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={t("title")}
      description={studentName ?? undefined}
      size="sm"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void confirm()}
            data-testid="revert-confirm"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Undo2 className="size-3.5" aria-hidden />
            )}
            {t("confirm")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed">
          {t("body", { status: tStatus(currentStatus) })}
        </p>

        {billed && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("billedWarning")}</span>
          </div>
        )}

        <p className="text-muted-foreground text-xs leading-relaxed">{t("hint")}</p>

        {error !== null && (
          <p
            data-testid="revert-error"
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-3 text-xs leading-relaxed"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
