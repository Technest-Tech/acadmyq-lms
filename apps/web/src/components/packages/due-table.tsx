"use client";

import {
  AlertTriangle,
  BadgeCheck,
  BellOff,
  BookOpenCheck,
  CircleDollarSign,
  ExternalLink,
  FileImage,
  Hourglass,
  Receipt,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { daysSince, owed } from "@/components/packages/family-due-group";
import { KNOWN_METHODS, paidAmount } from "@/components/packages/paid-package-card";
import { StatCard } from "@/components/ui/stat-card";
import type { LessonPackageRow } from "@/lib/api";
import { apiBase } from "@/lib/api-base";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

// ── Stat cards ────────────────────────────────────────────────────────────────

/**
 * The Due page's stat cards (Ahmed 2026-11-22: "the statistics as coloured cards"): how many packages
 * wait and in how many families, the money owed per currency, how many have had no reminder, and how
 * long the oldest has waited. Over every due package, not just the ones the search shows.
 */
export function DueStats({
  rows,
  dueAmounts,
}: {
  /** Every package on Due. */
  rows: LessonPackageRow[];
  /** The server's per-currency total, when the summary has come back. */
  dueAmounts?: { currency: string; amount_minor: number }[];
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const families = new Set(rows.map((r) => r.guardian_id ?? `student:${r.student_id}`)).size;
  const amounts = dueAmounts ?? owed(rows);
  const reminded = rows.filter((r) => r.reminders_sent > 0).length;
  const oldest = rows.reduce<LessonPackageRow | null>((o, r) => (o === null || r.created_at < o.created_at ? r : o), null);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="due-stats">
      <StatCard
        tone="rose"
        icon={AlertTriangle}
        label={t("dueStats.packages")}
        values={[formatNumber(rows.length, locale)]}
        hint={rows.length > 0 ? t("dueStats.families", { count: families }) : undefined}
        testId="due-count"
      />
      <StatCard
        tone="amber"
        icon={CircleDollarSign}
        label={t("dueStats.amount")}
        values={amounts.length > 0 ? amounts.map((a) => formatMoney({ amount: a.amount_minor, currency: a.currency }, locale)) : ["—"]}
        testId="due-stats-amount"
      />
      <StatCard
        tone="sky"
        icon={BellOff}
        label={t("dueStats.notReminded")}
        values={[formatNumber(rows.length - reminded, locale)]}
        hint={t("dueStats.reminded", { count: reminded })}
        testId="due-stats-not-reminded"
      />
      <StatCard
        tone="violet"
        icon={Hourglass}
        label={t("dueStats.oldest")}
        values={[oldest === null ? t("dueStats.nothing") : new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-daysSince(oldest.created_at), "day")]}
        hint={oldest?.student_name}
        testId="due-stats-oldest"
      />
    </div>
  );
}

/** The Paid tab's cards: how many packages are paid, and what they brought in per currency. */
export function PaidStats({
  count,
  collected,
}: {
  count: number;
  collected: { currency: string; amount_minor: number }[];
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="paid-stats">
      <StatCard tone="emerald" icon={BadgeCheck} label={t("dueStats.paidCount")} values={[formatNumber(count, locale)]} testId="paid-stats-count" />
      <StatCard
        tone="sky"
        icon={Wallet}
        label={t("dueStats.collected")}
        values={collected.length > 0 ? collected.map((c) => formatMoney({ amount: c.amount_minor, currency: c.currency }, locale)) : ["—"]}
        testId="paid-stats-collected"
      />
    </div>
  );
}

// ── The Paid tab's table ──────────────────────────────────────────────────────
// (The unpaid tab is family cards again — see FamilyDueGroup.)

const HEAD = "px-3 py-2 text-start text-[11px] font-semibold whitespace-nowrap";
const CELL = "px-3 py-2 whitespace-nowrap";
const ICON_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-50";

/**
 * The Due page's Paid tab as a compact table, one line per package (phones and tablets keep the
 * paid cards): who, the parent, which package, what came in, how, when, the reference, and the
 * receipt / invoice / lessons behind it.
 */
export function PaidTable({
  rows,
  timezone,
  onOpenDetail,
}: {
  rows: LessonPackageRow[];
  timezone: string;
  onOpenDetail: (row: LessonPackageRow) => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const methodLabel = (m: string | null) => (m === null ? "—" : KNOWN_METHODS.includes(m) ? t(`paid.method.${m}`) : m);

  return (
    <section className="bg-card hidden overflow-hidden rounded-xl border border-emerald-200/70 shadow-sm lg:block dark:border-emerald-900/50" data-testid="paid-table">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-muted-foreground border-b bg-gradient-to-l from-emerald-500/[0.10] via-emerald-500/[0.035] to-transparent">
              <th className={cn(HEAD, "ps-4")}>{t("dueTable.student")}</th>
              <th className={HEAD}>{t("dueTable.family")}</th>
              <th className={HEAD}>{t("dueTable.package")}</th>
              <th className={cn(HEAD, "text-end")}>{t("dueTable.paidAmount")}</th>
              <th className={HEAD}>{t("paid.methodLabel")}</th>
              <th className={HEAD}>{t("paid.paidAt")}</th>
              <th className={HEAD}>{t("paid.reference")}</th>
              <th className={cn(HEAD, "pe-4 text-end")}>
                <span className="sr-only">{t("dueTable.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const receipts = row.receipts ?? [];
              const methods = receipts.length > 0 ? [...new Set(receipts.map((r) => methodLabel(r.method)))].join("، ") : methodLabel(row.payment_method);
              const paidOn = row.paid_at !== null ? formatDateTime(row.paid_at, timezone, locale) : (receipts[0]?.received_on ?? "—");
              const reference = receipts.find((r) => r.reference)?.reference ?? row.payment_reference ?? "—";
              const receipt = receipts[0] ?? null;
              const proof = receipt !== null ? receipt.public_url : row.payment_proof_url !== null ? `${apiBase()}${row.payment_proof_url}` : null;
              return (
                <tr key={row.id} className={cn("transition-colors hover:bg-emerald-500/[0.05]", i > 0 && "border-t border-border/50", i % 2 === 1 && "bg-muted/30")} data-testid="paid-table-row">
                  <td className={cn(CELL, "ps-4")}>
                    <button type="button" onClick={() => onOpenDetail(row)} className="hover:text-primary block max-w-44 truncate text-start font-medium transition-colors">
                      {row.student_name}
                    </button>
                  </td>
                  <td className={cn(CELL, "text-muted-foreground max-w-40 truncate text-xs")}>
                    {row.guardian_name && row.guardian_name !== row.student_name ? row.guardian_name : "—"}
                  </td>
                  <td className={cn(CELL, "text-muted-foreground max-w-40 truncate text-xs")}>
                    <span className="text-foreground font-semibold tabular-nums">#{formatNumber(row.sequence_no, locale)}</span> {row.label}
                  </td>
                  <td className={cn(CELL, "text-end")}>
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
                      <BadgeCheck className="size-3.5" aria-hidden />
                      {formatMoney({ amount: paidAmount(row), currency: row.currency }, locale)}
                    </span>
                  </td>
                  <td className={cn(CELL, "text-xs font-medium")}>{methods}</td>
                  <td className={cn(CELL, "text-muted-foreground text-xs tabular-nums")}>{paidOn}</td>
                  <td className={cn(CELL, "text-muted-foreground max-w-32 truncate text-xs")} title={reference} data-testid="paid-table-reference">
                    {reference}
                  </td>
                  <td className={cn(CELL, "pe-4")}>
                    <div className="flex items-center justify-end gap-1">
                      {proof !== null && (
                        <a
                          href={proof}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(ICON_BUTTON, "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300")}
                          aria-label={receipt !== null ? t("paid.openReceipt") : t("actions.viewProof")}
                          title={receipt !== null ? t("paid.openReceipt") : t("actions.viewProof")}
                        >
                          {receipt !== null ? <ExternalLink className="size-3.5" aria-hidden /> : <FileImage className="size-3.5" aria-hidden />}
                        </a>
                      )}
                      <Link
                        href={`/invoices?id=${row.invoice_id}`}
                        className={cn(ICON_BUTTON, "border-border/70 bg-muted/60 text-foreground/80 hover:bg-muted")}
                        aria-label={t("actions.viewInvoice")}
                        title={t("actions.viewInvoice")}
                      >
                        <Receipt className="size-3.5" aria-hidden />
                      </Link>
                      <button
                        type="button"
                        onClick={() => onOpenDetail(row)}
                        className={cn(ICON_BUTTON, "border-border/70 bg-muted/60 text-foreground/80 hover:bg-muted")}
                        aria-label={t("actions.viewLessons")}
                        title={t("actions.viewLessons")}
                      >
                        <BookOpenCheck className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
