"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { MarkPaidModal } from "@/components/invoices/mark-paid-modal";
import { ClosePackageModal } from "@/components/packages/close-package-modal";
import { EditPackageForm } from "@/components/packages/edit-package-form";
import { OpenPackageForm } from "@/components/packages/open-package-form";
import type { PackageActionProps } from "@/components/packages/package-card";
import { PackageDetail } from "@/components/packages/package-detail";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  billPackageOverdraft,
  closeLessonPackage,
  remindLessonPackage,
  sendInvoicePaymentLink,
  syncLessonPackage,
  type LessonPackageRow,
} from "@/lib/api";

type PackageModal =
  | { kind: "closed" }
  | { kind: "open"; studentId?: string }
  | { kind: "detail"; row: LessonPackageRow }
  | { kind: "edit"; row: LessonPackageRow }
  | { kind: "close"; row: LessonPackageRow }
  | { kind: "toMonthly"; row: LessonPackageRow }
  | { kind: "markPaid"; row: LessonPackageRow };

/**
 * Everything a package card can do — the handlers and the modals behind them — for any screen that
 * shows {@link PackageCard}s: the packages pages and the student's profile. One definition, so the
 * same package offers the same buttons, and the same forms behind them, wherever it is shown.
 *
 * The screen keeps its own rows: `onChanged` asks it to reload, `onAlert` to show the outcome, and
 * `onReminded` (optional) lets it patch the reminder count in place instead of reloading.
 */
export function usePackageActions({
  onChanged,
  onAlert,
  onReminded,
  studentsWithHistory,
}: {
  onChanged: () => void;
  onAlert: (variant: "success" | "error", message: string) => void;
  onReminded?: (rowId: string, result: Awaited<ReturnType<typeof remindLessonPackage>>) => void;
  /** Students with a closed package behind them — the only ones carry-over can do anything for. */
  studentsWithHistory?: Set<string>;
}): {
  actionProps: (row: LessonPackageRow) => PackageActionProps;
  /** Open the "new package" form, with a student already chosen when given. */
  openNew: (studentId?: string) => void;
  openDetail: (row: LessonPackageRow) => void;
  modals: ReactNode;
} {
  const t = useTranslations("packages");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("package.manage");
  const canSendInvoice = can("invoice.send_link");
  const canMarkPaid = can("invoice.mark_paid");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const [modal, setModal] = useState<PackageModal>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);

  const close = () => setModal({ kind: "closed" });
  const saved = (message: string) => {
    close();
    onChanged();
    onAlert("success", message);
  };

  /**
   * A student whose block ran out, moved back to the monthly clock. The same close endpoint as
   * closing early with "return to monthly" ticked — on a package that already closed itself it
   * changes nothing about the package and only flips the billing mode.
   */
  async function confirmReturnToMonthly(row: LessonPackageRow) {
    setBusy(true);
    try {
      await closeLessonPackage(row.id, undefined, true);
      saved(t("alerts.returnedToMonthly", { name: row.student_name }));
    } catch {
      onAlert("error", t("alerts.returnFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function billOverdraft(row: LessonPackageRow) {
    try {
      await billPackageOverdraft(row.id);
      onChanged();
      onAlert("success", t("alerts.overdraftBilled"));
    } catch {
      onAlert("error", t("alerts.overdraftFailed"));
    }
  }

  async function syncLessons(row: LessonPackageRow) {
    setSyncingId(row.id);
    try {
      const result = await syncLessonPackage(row.id);
      onChanged();
      onAlert(
        "success",
        result.skipped_locked > 0
          ? t("alerts.syncedWithLocked", {
              imported: result.imported,
              locked: result.skipped_locked,
            })
          : t("alerts.synced", { count: result.imported }),
      );
    } catch {
      onAlert("error", t("alerts.syncFailed"));
    } finally {
      setSyncingId(null);
    }
  }

  async function sendPayment(row: LessonPackageRow) {
    if (row.invoice_id === null) return;
    setSendingId(row.id);
    try {
      const result = await sendInvoicePaymentLink(row.invoice_id);
      if (!result.sent && result.phone) {
        const digits = result.phone.replace(/\D+/g, "");
        window.open(
          `https://wa.me/${digits}?text=${encodeURIComponent(result.message)}`,
          "_blank",
          "noopener,noreferrer",
        );
      }
      onAlert(
        "success",
        result.sent ? t("alerts.paymentSent") : t("alerts.paymentReady"),
      );
    } catch {
      onAlert("error", t("alerts.paymentFailed"));
    } finally {
      setSendingId(null);
    }
  }

  /**
   * Remind the payer — pay what is due, or renew a block that ran out (the server picks which).
   * It opens WhatsApp the ordinary way, with the message written, and the staff member sends it —
   * never through the gateway. Counted on the package either way, so the next person on the case
   * can see the family has already been chased, how often, and when.
   */
  async function remind(row: LessonPackageRow) {
    setRemindingId(row.id);
    // Opened on the click itself: a tab opened after the request returns is a popup the browser
    // is entitled to block. It is pointed at WhatsApp once the message is ready.
    const tab = window.open("", "_blank");
    try {
      const result = await remindLessonPackage(row.id, locale);
      if (tab !== null) {
        tab.opener = null;
        tab.location.href = result.deeplink;
      } else {
        window.open(result.deeplink, "_blank", "noopener,noreferrer");
      }
      if (onReminded) onReminded(row.id, result);
      else onChanged();
      onAlert("success", t("alerts.reminderReady"));
    } catch (err) {
      tab?.close();
      onAlert(
        "error",
        err instanceof ApiError && err.message
          ? err.message
          : t("alerts.reminderFailed"),
      );
    } finally {
      setRemindingId(null);
    }
  }

  const actionProps = (row: LessonPackageRow): PackageActionProps => ({
    row,
    canManage,
    canSendInvoice,
    canMarkPaid,
    syncing: syncingId === row.id,
    sendingPayment: sendingId === row.id,
    reminding: remindingId === row.id,
    onRemind: () => void remind(row),
    onOpenDetail: () => setModal({ kind: "detail", row }),
    onEdit: () => setModal({ kind: "edit", row }),
    onClose: () => setModal({ kind: "close", row }),
    onBillOverdraft: () => void billOverdraft(row),
    onSyncLessons: () => void syncLessons(row),
    onSendPayment: () => void sendPayment(row),
    onMarkPaid: () => setModal({ kind: "markPaid", row }),
    onRenew: () => setModal({ kind: "open", studentId: row.student_id }),
    onReturnToMonthly: () => setModal({ kind: "toMonthly", row }),
  });

  const modals = (
    <>
      {/* ── Open ─────────────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "open"}
        onClose={close}
        title={t("form.title")}
        description={t("form.description")}
        size="md"
      >
        {modal.kind === "open" && (
          <OpenPackageForm
            initialStudentId={modal.studentId}
            studentsWithHistory={studentsWithHistory}
            onCancel={close}
            onSaved={saved}
          />
        )}
      </Modal>

      {/* ── Correct the terms ────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "edit"}
        onClose={close}
        title={t("edit.title")}
        description={t("edit.description")}
        size="md"
      >
        {modal.kind === "edit" && (
          <EditPackageForm row={modal.row} onCancel={close} onSaved={saved} />
        )}
      </Modal>

      {/* ── The ledger ───────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "detail"}
        onClose={close}
        title={modal.kind === "detail" ? modal.row.student_name : ""}
        description={modal.kind === "detail" ? modal.row.label : undefined}
        size="lg"
      >
        {modal.kind === "detail" && (
          <PackageDetail
            row={modal.row}
            timezone={timezone}
            canManage={canManage}
            onChanged={onChanged}
          />
        )}
      </Modal>

      {/* ── Close early ──────────────────────────────────────────────── */}
      <ClosePackageModal
        row={modal.kind === "close" ? modal.row : null}
        onClose={close}
        onDone={saved}
        onError={(message) => onAlert("error", message)}
      />

      {/* ── Out of hours → back to monthly ───────────────────────────── */}
      <Modal
        open={modal.kind === "toMonthly"}
        onClose={close}
        title={t("toMonthly.title")}
        size="sm"
      >
        {modal.kind === "toMonthly" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {t("toMonthly.body", { name: modal.row.student_name })}
            </p>
            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
                {t("actions.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={() => void confirmReturnToMonthly(modal.row)}
                disabled={busy}
                data-testid="confirm-to-monthly"
              >
                {t("toMonthly.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {modal.kind === "markPaid" && modal.row.invoice_id !== null && (
        <MarkPaidModal
          open
          invoiceId={modal.row.invoice_id}
          totalMinor={modal.row.invoice_total_minor}
          currency={modal.row.currency}
          onClose={close}
          onSuccess={() => saved(t("alerts.markedPaid"))}
        />
      )}
    </>
  );

  return {
    actionProps,
    openNew: (studentId) => setModal({ kind: "open", studentId }),
    openDetail: (row) => setModal({ kind: "detail", row }),
    modals,
  };
}
