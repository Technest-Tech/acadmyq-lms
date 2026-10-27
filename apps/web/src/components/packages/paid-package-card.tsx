"use client";

import { BadgeCheck, BookOpenCheck, ExternalLink, FileImage, Receipt } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import type { LessonPackageRow } from "@/lib/api";
import { apiBase } from "@/lib/api-base";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Methods a bill or receipt can be settled by; anything else shows as written. */
const KNOWN_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "PAYPAL",
  "XPAY",
  "GATEWAY",
  "INSTAPAY",
  "WALLET",
  "CARD",
  "OTHER",
];

/**
 * A package whose bill is settled in full — the Paid tab of the Due page. VOID is not paid. On an
 * academy kept by receipts a running bill can stay OPEN once covered, so "nothing left and
 * something received" counts as well as the PAID status.
 */
export function isPackageBillPaid(row: LessonPackageRow): boolean {
  return (
    row.invoice_id !== null &&
    row.invoice_status !== "VOID" &&
    row.outstanding_minor === 0 &&
    (row.paid_at !== null || row.invoice_status === "PAID" || row.invoice_paid_minor > 0)
  );
}

/** What a paid package brought in: what was received on the bill, or its total on a classic bill. */
export function paidAmount(row: LessonPackageRow): number {
  return row.invoice_paid_minor > 0 ? row.invoice_paid_minor : row.invoice_total_minor;
}

/**
 * A paid package on the Due page's Paid tab — where the admin checks what came in: how much, when,
 * how, the reference and note typed at the time, who took it, and the receipt. An academy kept by
 * receipts lists each receipt that paid the bill (number, link to the printable receipt, proof);
 * a classic academy has one payment written on the bill itself.
 */
export function PaidPackageCard({
  row,
  timezone,
  onOpenDetail,
}: {
  row: LessonPackageRow;
  timezone: string;
  onOpenDetail: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const methodLabel = (m: string | null) =>
    m === null ? "—" : KNOWN_METHODS.includes(m) ? t(`paid.method.${m}`) : m;
  const receipts = row.receipts ?? [];

  return (
    <article
      className="bg-card min-w-0 overflow-hidden rounded-2xl border border-emerald-200/70 shadow-sm dark:border-emerald-900/50"
      data-testid="paid-package"
    >
      <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-emerald-500/[0.09] via-emerald-500/[0.03] to-transparent px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{row.student_name}</p>
          {row.guardian_name && row.guardian_name !== row.student_name && (
            <p className="text-muted-foreground truncate text-xs">{row.guardian_name}</p>
          )}
          <p className="text-muted-foreground mt-0.5 text-xs">
            #{row.sequence_no} · {row.label}
          </p>
          {row.paid_at !== null && (
            <p className="mt-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              {t("paid.paidAt")}: {formatDateTime(row.paid_at, timezone, locale)}
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
          <BadgeCheck className="size-3.5" aria-hidden />
          {formatMoney({ amount: paidAmount(row), currency: row.currency }, locale)}
        </span>
      </header>

      {receipts.length > 0 ? (
        <ul className="divide-y">
          {receipts.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3" data-testid="paid-receipt-row">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold">{t("paid.receipt", { number: r.number })}</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney({ amount: r.amount_minor, currency: r.currency }, locale)}
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                <Detail label={t("paid.paidAt")} value={r.received_on} />
                <Detail label={t("paid.methodLabel")} value={methodLabel(r.method)} />
                <Detail label={t("paid.reference")} value={r.reference ?? "—"} testId="paid-reference" />
                <Detail label={t("paid.receivedBy")} value={r.received_by_name ?? "—"} />
                {r.note !== null && <Detail label={t("paid.note")} value={r.note} wide />}
              </dl>
              <div className="flex flex-wrap gap-2">
                <a
                  href={r.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="paid-receipt"
                  className={cn(buttonVariants({ size: "sm" }), "gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700")}
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  {t("paid.openReceipt")}
                </a>
                {r.proof_url !== null && (
                  <a
                    href={`${apiBase()}${r.proof_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
                  >
                    <FileImage className="size-3.5" aria-hidden />
                    {t("paid.proof")}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 text-xs sm:grid-cols-2">
          <Detail label={t("paid.methodLabel")} value={methodLabel(row.payment_method)} />
          <Detail label={t("paid.reference")} value={row.payment_reference ?? "—"} testId="paid-reference" />
          {row.payment_reason !== null && <Detail label={t("paid.note")} value={row.payment_reason} wide />}
        </dl>
      )}

      <div className="flex flex-wrap gap-2 border-t px-4 py-3">
        {receipts.length === 0 &&
          (row.payment_proof_url !== null ? (
            <a
              href={`${apiBase()}${row.payment_proof_url}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="paid-receipt"
              className={cn(buttonVariants({ size: "sm" }), "gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700")}
            >
              <FileImage className="size-3.5" aria-hidden />
              {t("actions.viewProof")}
            </a>
          ) : (
            <span className="text-muted-foreground self-center text-xs">{t("paid.noReceipt")}</span>
          ))}
        <Link
          href={`/invoices?id=${row.invoice_id}`}
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
        >
          <Receipt className="size-3.5" aria-hidden />
          {t("actions.viewInvoice")}
        </Link>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={onOpenDetail}>
          <BookOpenCheck className="size-3.5" aria-hidden />
          {t("actions.viewLessons")}
        </Button>
      </div>
    </article>
  );
}

function Detail({
  label,
  value,
  testId,
  wide = false,
}: {
  label: string;
  value: string;
  testId?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold break-words" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
