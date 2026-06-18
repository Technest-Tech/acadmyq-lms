"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MarkPaidModal } from "@/components/invoices/mark-paid-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── API shapes ─────────────────────────────────────────────────────────────────

export interface InvoiceLineItem {
  id: string;
  session_id: string | null;
  session_date: string | null;
  student_name: string | null;
  description: string;
  amount_minor: number;
  currency: string;
  session_status: string | null;
  duration_minutes: number | null;
  teacher_name: string | null;
}

export interface InvoiceDetail {
  id: string;
  payer_name: string;
  payer_type: "GUARDIAN" | "STUDENT";
  payer_phone: string | null;
  period_month: number;
  period_year: number;
  status: "OPEN" | "CLOSED" | "PAID" | "PARTIALLY_PAID";
  total_minor: number;
  subtotal_minor: number;
  amount_paid_minor: number;
  currency: string;
  public_token: string;
  payment_method: string | null;
  payment_reason: string | null;
  closed_at: string | null;
  paid_at: string | null;
  sent_at: string | null;
  sent_channel: string | null;
  created_at: string;
}

interface InvoiceDetailResponse {
  invoice: InvoiceDetail;
  lineItems: InvoiceLineItem[];
}

interface SendLinkResult {
  phone: string;
  message: string;
  url: string;
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<InvoiceDetail["status"], string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  CLOSED:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  PARTIALLY_PAID:
    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
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

// ── Copy-to-clipboard button ────────────────────────────────────────────────────

function CopyButton({
  value,
  label,
  copiedLabel,
  icon: Icon = Copy,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  icon?: typeof Copy;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — no-op */
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" aria-hidden />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {copied ? copiedLabel : label}
    </Button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface InvoiceDetailModalProps {
  invoiceId: string | null;
  onClose: () => void;
}

/** Digits-only phone for a wa.me deep link (drops +, spaces, dashes). */
function waLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** One lesson group (a single child's lessons within a guardian invoice). */
interface LessonGroup {
  student: string;
  lines: InvoiceLineItem[];
  subtotal: number;
}

/**
 * Groups line items by student, preserving first-seen order. Used to break a
 * guardian's invoice into per-child sections when more than one child is billed.
 */
function groupByStudent(items: InvoiceLineItem[]): LessonGroup[] {
  const map = new Map<string, LessonGroup>();
  for (const li of items) {
    const key = li.student_name ?? "—";
    const group = map.get(key);
    if (group) {
      group.lines.push(li);
      group.subtotal += li.amount_minor;
    } else {
      map.set(key, { student: key, lines: [li], subtotal: li.amount_minor });
    }
  }
  return Array.from(map.values());
}

/** A single lesson row in the line-items table. */
function LessonRow({
  li,
  showStudent,
}: {
  li: InvoiceLineItem;
  showStudent: boolean;
}) {
  const t = useTranslations("invoices");
  const tStatus = useTranslations("scheduling.status");
  const locale = useLocale();
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  // Non-charged lessons (cancelled, free or trial — #19) ride along for the record only, shown muted
  // so they're never mistaken for a billed line. A zero amount is the single tell: every such lesson
  // bills at zero and is excluded from the total.
  const isNotCharged = li.amount_minor === 0;
  return (
    <tr
      className={cn(
        "hover:bg-muted/20 transition-colors",
        isNotCharged && "text-muted-foreground italic",
      )}
    >
      <td className="px-4 py-2.5 tabular-nums">
        {li.session_date ? dateFmt.format(new Date(li.session_date)) : "—"}
      </td>
      {showStudent && <td className="px-4 py-2.5">{li.student_name ?? "—"}</td>}
      <td className="px-4 py-2.5">{li.teacher_name ?? "—"}</td>
      <td className="px-4 py-2.5">
        {li.session_status ? tStatus(li.session_status) : "—"}
      </td>
      <td className="text-muted-foreground px-4 py-2.5 text-end tabular-nums">
        {li.duration_minutes != null
          ? t("liDurationValue", { count: li.duration_minutes })
          : "—"}
      </td>
      <td className="px-4 py-2.5 text-end tabular-nums">
        {isNotCharged ? (
          <span className="text-muted-foreground">{t("liNotCharged")}</span>
        ) : (
          formatMoney(
            { amount: li.amount_minor, currency: li.currency },
            locale,
          )
        )}
      </td>
    </tr>
  );
}

/**
 * Modal that fetches and displays a single invoice (Sprint 7). CLOSED /
 * PARTIALLY_PAID invoices expose Mark Paid + Send WhatsApp Link actions; the
 * detail auto-refreshes after a successful mark-paid. Line items come back under a
 * sibling `lineItems` key, not nested in the invoice.
 */
export function InvoiceDetailModal({
  invoiceId,
  onClose,
}: InvoiceDetailModalProps) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const { can } = useAuth();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
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
      const res = await apiFetch<InvoiceDetailResponse>(`/api/invoices/${id}`);
      setInvoice(res.invoice);
      setLineItems(res.lineItems ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (invoiceId) {
      setInvoice(null);
      setLineItems([]);
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
      // Reflect the freshly recorded sent_at without a full reload race.
      setInvoice((prev) =>
        prev ? { ...prev, sent_at: new Date().toISOString() } : prev,
      );
    } catch (err) {
      setLinkError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSendingLink(false);
    }
  }

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  const title = invoice
    ? `${t("detailTitle")} · ${String(invoice.period_month).padStart(2, "0")}/${invoice.period_year}`
    : t("detailTitle");

  const isGuardian = invoice?.payer_type === "GUARDIAN";

  // When a guardian's invoice spans more than one child, break the lessons into
  // a section per child instead of a flat list (#7).
  const lessonGroups = groupByStudent(lineItems);
  const grouped = isGuardian && lessonGroups.length > 1;
  const showStudentCol = isGuardian && !grouped;
  const colCount = showStudentCol ? 6 : 5;

  const canAct =
    invoice?.status === "OPEN" ||
    invoice?.status === "CLOSED" ||
    invoice?.status === "PARTIALLY_PAID";
  const showActions =
    canAct && (can("invoice.send_link") || can("invoice.mark_paid"));

  const publicUrl =
    invoice && typeof window !== "undefined"
      ? `${window.location.origin}/i/${invoice.public_token}`
      : "";

  const balanceDue = invoice
    ? Math.max(0, invoice.total_minor - invoice.amount_paid_minor)
    : 0;
  const paidPct =
    invoice && invoice.total_minor > 0
      ? Math.min(
          100,
          Math.round((invoice.amount_paid_minor / invoice.total_minor) * 100),
        )
      : 0;

  return (
    <>
      <Modal
        open={invoiceId !== null}
        onClose={onClose}
        title={title}
        description={invoice?.payer_name}
        size="xl"
        footer={
          showActions ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              {can("invoice.send_link") && (
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
              )}
              {can("invoice.mark_paid") && (
                <Button
                  type="button"
                  size="sm"
                  className="ms-auto"
                  onClick={() => setMarkPaidOpen(true)}
                >
                  {t("markPaid")}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4" aria-label={t("loading")} aria-busy>
            <div className="bg-muted h-16 animate-pulse rounded-xl" />
            <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
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
            {/* Hero summary */}
            <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs font-medium">
                  {t("colPayer")}
                </p>
                <p className="truncate text-base font-semibold">
                  {invoice.payer_name}
                </p>
                {invoice.payer_phone && (
                  <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                    <bdi dir="ltr">{invoice.payer_phone}</bdi>
                  </p>
                )}
              </div>
              <div className="text-end">
                <StatusBadge status={invoice.status} />
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {formatMoney(
                    { amount: invoice.total_minor, currency: invoice.currency },
                    locale,
                  )}
                </p>
              </div>
            </div>

            {/* Payment progress — shown once the invoice is closed or partly paid */}
            {(invoice.status === "PARTIALLY_PAID" ||
              invoice.amount_paid_minor > 0 ||
              invoice.status === "CLOSED") && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">
                    {t("paymentProgress")}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(
                      {
                        amount: invoice.amount_paid_minor,
                        currency: invoice.currency,
                      },
                      locale,
                    )}{" "}
                    /{" "}
                    {formatMoney(
                      {
                        amount: invoice.total_minor,
                        currency: invoice.currency,
                      },
                      locale,
                    )}
                  </span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      paidPct >= 100 ? "bg-emerald-500" : "bg-amber-500",
                    )}
                    style={{ width: `${Math.max(paidPct, 2)}%` }}
                  />
                </div>
                {balanceDue > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t("balanceDue")}:{" "}
                    <span className="font-semibold tabular-nums">
                      {formatMoney(
                        { amount: balanceDue, currency: invoice.currency },
                        locale,
                      )}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Paid meta */}
            {invoice.status === "PAID" && invoice.paid_at && (
              <AlertBanner
                variant="success"
                message={`${t("paidAt")}: ${dateFmt.format(new Date(invoice.paid_at))}${
                  invoice.payment_method
                    ? ` · ${t("paymentMethodValue", { method: t(`method${methodKey(invoice.payment_method)}`) })}`
                    : ""
                }`}
              />
            )}

            {/* Line items table */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t("lessons")}</h3>
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      <th className="text-muted-foreground px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide">
                        {t("liDate")}
                      </th>
                      {showStudentCol && (
                        <th className="text-muted-foreground px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide">
                          {t("liStudent")}
                        </th>
                      )}
                      <th className="text-muted-foreground px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide">
                        {t("liTeacher")}
                      </th>
                      <th className="text-muted-foreground px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide">
                        {t("liStatus")}
                      </th>
                      <th className="text-muted-foreground px-4 py-2.5 text-end text-xs font-semibold uppercase tracking-wide">
                        {t("liDuration")}
                      </th>
                      <th className="text-muted-foreground px-4 py-2.5 text-end text-xs font-semibold uppercase tracking-wide">
                        {t("liAmount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lineItems.length === 0 && (
                      <tr>
                        <td
                          colSpan={colCount}
                          className="text-muted-foreground px-4 py-6 text-center text-sm"
                        >
                          {t("empty")}
                        </td>
                      </tr>
                    )}
                    {grouped
                      ? lessonGroups.map((g) => (
                          <Fragment key={g.student}>
                            {/* Per-child section header + subtotal */}
                            <tr className="bg-muted/40">
                              <td
                                colSpan={colCount - 1}
                                className="px-4 py-2 text-xs font-semibold"
                              >
                                {g.student}
                                <span className="text-muted-foreground ms-2 font-normal">
                                  {t("liLessonsCount", {
                                    count: g.lines.length,
                                  })}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-end text-xs font-semibold tabular-nums">
                                {formatMoney(
                                  {
                                    amount: g.subtotal,
                                    currency: invoice.currency,
                                  },
                                  locale,
                                )}
                              </td>
                            </tr>
                            {g.lines.map((li) => (
                              <LessonRow
                                key={li.id}
                                li={li}
                                showStudent={false}
                              />
                            ))}
                          </Fragment>
                        ))
                      : lineItems.map((li) => (
                          <LessonRow
                            key={li.id}
                            li={li}
                            showStudent={showStudentCol}
                          />
                        ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/20 border-t font-semibold">
                      <td
                        colSpan={colCount - 1}
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

            {/* Public link row */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <Link2
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden
              />
              <code className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                {publicUrl}
              </code>
              <CopyButton
                value={publicUrl}
                label={t("copyLink")}
                copiedLabel={t("copied")}
              />
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("viewPublicPage")}
              </a>
            </div>

            {/* WhatsApp link feedback — surface the actual message to copy/send */}
            {linkResult && (
              <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800/40 dark:bg-emerald-950/30">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  {t("whatsappReady")}
                </p>
                <pre className="bg-card/60 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border p-2.5 text-xs leading-relaxed">
                  {linkResult.message}
                </pre>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton
                    value={linkResult.message}
                    label={t("copyMessage")}
                    copiedLabel={t("copied")}
                  />
                  {linkResult.phone ? (
                    <a
                      href={waLink(linkResult.phone, linkResult.message)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ size: "sm" }))}
                    >
                      <MessageSquare className="size-3.5" aria-hidden />
                      {t("openInWhatsApp")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {t("noPhone")}
                    </span>
                  )}
                </div>
              </div>
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

      {/* Mark Paid sub-modal — only rendered when invoice is loaded + actionable */}
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

/** CASH → "Cash", BANK_TRANSFER → "BankTransfer", OTHER → "Other" (i18n key suffix). */
function methodKey(method: string): string {
  switch (method) {
    case "CASH":
      return "Cash";
    case "BANK_TRANSFER":
      return "BankTransfer";
    default:
      return "Other";
  }
}
