"use client";

import { MessageSquare, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { MarkPaidModal } from "@/components/invoices/mark-paid-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

// ── API shapes ─────────────────────────────────────────────────────────────────

export interface InvoiceLineItem {
  id: string;
  session_id: string | null;
  session_date: string | null;
  student_name: string | null;
  description: string;
  amount_minor: number;
  currency: string;
}

export interface InvoiceDetail {
  id: string;
  payer_name: string;
  payer_type: "GUARDIAN" | "STUDENT";
  payer_whatsapp_phone: string | null;
  period_month: number;
  period_year: number;
  status: "OPEN" | "CLOSED" | "PAID" | "PARTIALLY_PAID";
  total_minor: number;
  amount_paid_minor: number;
  currency: string;
  line_items: InvoiceLineItem[];
  closed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

interface SendLinkResult {
  phone: string;
  message: string;
  deeplink: string;
  sentAt: string;
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<InvoiceDetail["status"], string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  CLOSED: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  PARTIALLY_PAID: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
};

function StatusBadge({ status }: { status: InvoiceDetail["status"] }) {
  const t = useTranslations("invoices");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface InvoiceDetailModalProps {
  invoiceId: string | null;
  onClose: () => void;
}

/**
 * Modal that fetches and displays a single invoice (Sprint 7).
 * CLOSED invoices show Mark Paid + Send WhatsApp Link actions.
 * The detail auto-refreshes after a successful mark-paid.
 */
export function InvoiceDetailModal({ invoiceId, onClose }: InvoiceDetailModalProps) {
  const t = useTranslations("invoices");
  const locale = useLocale();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mark Paid nested modal
  const [markPaidOpen, setMarkPaidOpen] = useState(false);

  // WhatsApp send-link state
  const [sendingLink, setSendingLink] = useState(false);
  const [linkResult, setLinkResult] = useState<SendLinkResult | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setLinkResult(null);
    setLinkError(null);
    try {
      const res = await apiFetch<{ invoice: InvoiceDetail }>(
        `/api/invoices/${id}`,
      );
      setInvoice(res.invoice);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : String(err),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (invoiceId) {
      setInvoice(null);
      void load(invoiceId);
    }
  }, [invoiceId, load]);

  async function handleSendLink() {
    if (!invoiceId) return;
    setSendingLink(true);
    setLinkError(null);
    setLinkResult(null);
    try {
      const res = await apiFetch<SendLinkResult>(
        `/api/invoices/${invoiceId}/send-link`,
        { method: "POST" },
      );
      setLinkResult(res);
    } catch (err) {
      setLinkError(
        err instanceof ApiError ? err.message : String(err),
      );
    } finally {
      setSendingLink(false);
    }
  }

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  const title = invoice
    ? `${t("detailTitle")} · ${String(invoice.period_month).padStart(2, "0")}/${invoice.period_year}`
    : t("detailTitle");

  const description = invoice ? invoice.payer_name : undefined;

  return (
    <>
      <Modal
        open={invoiceId !== null}
        onClose={onClose}
        title={title}
        description={description}
        size="lg"
        footer={
          invoice?.status === "CLOSED" ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sendingLink}
                onClick={() => void handleSendLink()}
              >
                {sendingLink ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <MessageSquare className="size-3.5" aria-hidden />
                )}
                {t("sendWhatsAppLink")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setMarkPaidOpen(true)}
              >
                {t("markPaid")}
              </Button>
            </div>
          ) : undefined
        }
      >
        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4" aria-label={t("loading")} aria-busy>
            <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
            <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
            <div className="bg-muted h-32 animate-pulse rounded-xl" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <AlertBanner
            variant="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}

        {/* Content */}
        {invoice && !loading && (
          <div className="space-y-5">
            {/* Meta row */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("colPayer")}
                </dt>
                <dd className="mt-0.5 font-semibold">{invoice.payer_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("colPeriod")}
                </dt>
                <dd className="mt-0.5 tabular-nums">
                  {String(invoice.period_month).padStart(2, "0")}/
                  {invoice.period_year}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("colStatus")}
                </dt>
                <dd className="mt-0.5">
                  <StatusBadge status={invoice.status} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs font-medium">
                  {t("total")}
                </dt>
                <dd className="mt-0.5 font-semibold tabular-nums">
                  {formatMoney(
                    { amount: invoice.total_minor, currency: invoice.currency },
                    locale,
                  )}
                </dd>
              </div>
              {invoice.amount_paid_minor > 0 && (
                <div>
                  <dt className="text-muted-foreground text-xs font-medium">
                    {t("amountPaid")}
                  </dt>
                  <dd className="mt-0.5 tabular-nums">
                    {formatMoney(
                      {
                        amount: invoice.amount_paid_minor,
                        currency: invoice.currency,
                      },
                      locale,
                    )}
                  </dd>
                </div>
              )}
              {invoice.paid_at && (
                <div>
                  <dt className="text-muted-foreground text-xs font-medium">
                    {t("paidAt")}
                  </dt>
                  <dd className="mt-0.5">
                    {dateFmt.format(new Date(invoice.paid_at))}
                  </dd>
                </div>
              )}
            </dl>

            {/* Line items table */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                {t("lineItems")}
              </h3>
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      <th className="text-muted-foreground px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide">
                        {t("liDate")}
                      </th>
                      {/* Student column only for guardian invoices (multiple children) */}
                      {invoice.payer_type === "GUARDIAN" && (
                        <th className="text-muted-foreground px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide">
                          {t("liStudent")}
                        </th>
                      )}
                      <th className="text-muted-foreground px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide">
                        {t("liDescription")}
                      </th>
                      <th className="text-muted-foreground px-4 py-2.5 text-end text-xs font-semibold uppercase tracking-wide">
                        {t("liAmount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoice.line_items.map((li) => (
                      <tr key={li.id} className="transition-colors">
                        <td className="text-muted-foreground px-4 py-2.5 tabular-nums">
                          {li.session_date
                            ? dateFmt.format(new Date(li.session_date))
                            : "—"}
                        </td>
                        {invoice.payer_type === "GUARDIAN" && (
                          <td className="px-4 py-2.5">
                            {li.student_name ?? "—"}
                          </td>
                        )}
                        <td className="px-4 py-2.5">{li.description}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums">
                          {formatMoney(
                            { amount: li.amount_minor, currency: li.currency },
                            locale,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Totals footer */}
                  <tfoot>
                    <tr className="bg-muted/20 border-t font-semibold">
                      <td
                        colSpan={
                          invoice.payer_type === "GUARDIAN" ? 3 : 2
                        }
                        className="px-4 py-2.5 text-end text-xs uppercase tracking-wide"
                      >
                        {t("total")}
                      </td>
                      <td className="px-4 py-2.5 text-end tabular-nums">
                        {formatMoney(
                          {
                            amount: invoice.total_minor,
                            currency: invoice.currency,
                          },
                          locale,
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* WhatsApp link feedback */}
            {linkResult && (
              <AlertBanner
                variant="success"
                message={t("linkSentTo", { phone: linkResult.phone })}
                onDismiss={() => setLinkResult(null)}
              />
            )}
            {linkError && (
              <AlertBanner
                variant="error"
                message={linkError}
                onDismiss={() => setLinkError(null)}
              />
            )}
          </div>
        )}
      </Modal>

      {/* Mark Paid sub-modal — only rendered when invoice is loaded + CLOSED */}
      {invoice && invoiceId && (
        <MarkPaidModal
          open={markPaidOpen}
          invoiceId={invoiceId}
          totalMinor={invoice.total_minor}
          currency={invoice.currency}
          onClose={() => setMarkPaidOpen(false)}
          onSuccess={() => {
            setMarkPaidOpen(false);
            void load(invoiceId);
          }}
        />
      )}
    </>
  );
}
