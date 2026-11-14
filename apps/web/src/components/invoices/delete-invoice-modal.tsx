"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

export interface DeleteInvoiceModalProps {
  open: boolean;
  invoiceId: string;
  payerName: string;
  totalMinor: number;
  currency: string;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * "Delete bill" on a custom bill raised by mistake (DELETE /api/invoices/{id}). The API only allows
 * it while nothing is paid on the bill and nothing (lessons, a group, a package) stands behind it —
 * the row's `can_delete` — and says why when it refuses.
 */
export function DeleteInvoiceModal({
  open,
  invoiceId,
  payerName,
  totalMinor,
  currency,
  onClose,
  onDeleted,
}: DeleteInvoiceModalProps) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/invoices/${invoiceId}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      // 422 = money landed on it meanwhile, or something stands behind it: said in the user's language.
      setError(
        err instanceof ApiError && err.status === 422
          ? t("deleteRefused")
          : err instanceof ApiError
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("deleteTitle")}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("deleteCancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="delete-invoice-confirm"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
            {t("deleteDo")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm" data-testid="delete-invoice">
        <p className="font-medium">
          {payerName} ·{" "}
          <span className="tabular-nums">
            {formatMoney({ amount: totalMinor, currency }, locale)}
          </span>
        </p>
        <p className="text-muted-foreground">{t("deleteHint")}</p>
        {error && (
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        )}
      </div>
    </Modal>
  );
}
