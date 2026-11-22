"use client";

import {
  AlertTriangle,
  BadgeCheck,
  BellOff,
  BellRing,
  BookOpenCheck,
  Check,
  CircleDollarSign,
  Copy,
  ExternalLink,
  FileImage,
  History,
  Hourglass,
  Link2,
  Loader2,
  Receipt,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  DUE_HIDDEN,
  owed,
  PrepaidChip,
  PURPOSE_TONE,
  purposeText,
  useFamilyPayLink,
  useRowPaymentCopy,
  type DueFamily,
} from "@/components/packages/family-due-group";
import { blockAmount, blockMinutes } from "@/components/packages/lesson-price-fields";
import { PackageActions, type PackageActionProps } from "@/components/packages/package-card";
import { PackageHistoryModal } from "@/components/packages/package-history-log";
import { KNOWN_METHODS, paidAmount } from "@/components/packages/paid-package-card";
import { StatCard } from "@/components/ui/stat-card";
import type { LessonPackageRow } from "@/lib/api";
import { apiBase } from "@/lib/api-base";
import { avatarTone } from "@/lib/avatar";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

// ── Stat cards ────────────────────────────────────────────────────────────────

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

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

// ── The Due table ─────────────────────────────────────────────────────────────

/** How long a debt has waited, in words, coloured by how worrying that is. */
function WaitingChip({ createdAt }: { createdAt: string }) {
  const locale = useLocale();
  const days = daysSince(createdAt);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap",
        days <= 2
          ? "bg-sky-500/12 text-sky-700 dark:text-sky-300"
          : days <= 7
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : "bg-rose-500/12 text-rose-700 dark:text-rose-300",
      )}
      data-testid="due-table-waiting"
    >
      {new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")}
    </span>
  );
}

const HEAD = "px-3 py-2 text-start text-[11px] font-semibold whitespace-nowrap";
const CELL = "px-3 py-2 whitespace-nowrap";
const ICON_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-50";

/**
 * The Due page as a plain, compact table (Ahmed 2026-11-22: a table, then "why so big — a normal
 * table, not that tall"): one line per package. A family's packages sit together; the parent's name
 * leads the family's first line, with what the family owes in all and ONE payment link for every
 * bill when there are two or more. Shown from laptop width up; phones and tablets keep the cards.
 */
export function DueTable({
  families,
  timezone,
  canSendInvoice,
  actionProps,
  onMessageOpened,
}: {
  families: DueFamily[];
  timezone: string;
  canSendInvoice: boolean;
  actionProps: (row: LessonPackageRow) => PackageActionProps;
  onMessageOpened: () => void;
}) {
  const t = useTranslations("packages");
  return (
    <section className="bg-card hidden overflow-hidden rounded-xl border shadow-sm lg:block" data-testid="due-table">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="from-primary/[0.09] via-primary/[0.035] text-muted-foreground border-b bg-gradient-to-l to-transparent">
              <th className={cn(HEAD, "ps-4")}>{t("dueTable.family")}</th>
              <th className={HEAD}>{t("dueTable.student")}</th>
              <th className={HEAD}>{t("dueTable.purpose")}</th>
              <th className={HEAD}>{t("dueTable.package")}</th>
              <th className={cn(HEAD, "text-end")}>{t("dueTable.amount")}</th>
              <th className={HEAD}>{t("dueTable.waiting")}</th>
              <th className={cn(HEAD, "pe-4 text-end")}>
                <span className="sr-only">{t("dueTable.actions")}</span>
              </th>
            </tr>
          </thead>
          {families.map((family, i) => (
            <FamilyBand
              key={family.key}
              family={family}
              striped={i % 2 === 1}
              timezone={timezone}
              canSendInvoice={canSendInvoice}
              actionProps={actionProps}
              onMessageOpened={onMessageOpened}
            />
          ))}
        </table>
      </div>
    </section>
  );
}

function FamilyBand({
  family,
  striped,
  timezone,
  canSendInvoice,
  actionProps,
  onMessageOpened,
}: {
  family: DueFamily;
  striped: boolean;
  timezone: string;
  canSendInvoice: boolean;
  actionProps: (row: LessonPackageRow) => PackageActionProps;
  onMessageOpened: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const totals = owed(family.rows);
  const { payable, familyLink, busy, copied, error, sendMessage, copyLink } = useFamilyPayLink(family, onMessageOpened);

  // The family's first line: the parent, the family's total when it has more than one package, and
  // the one link for all its bills.
  const familyCell = (
    <td className={cn(CELL, "relative max-w-56 ps-4")}>
      <span className={cn("absolute inset-y-1.5 start-0 w-1 rounded-e-full", avatarTone(family.name))} aria-hidden />
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-semibold" title={family.phone ? `${family.name} · ${family.phone}` : family.name} data-testid="due-table-family-name">
          {family.name}
        </span>
        {family.rows.length > 1 && totals.length > 0 && (
          <span className="shrink-0 text-xs font-bold text-rose-600 tabular-nums dark:text-rose-400" data-testid="due-table-family-total">
            {totals.map((o) => formatMoney({ amount: o.amount_minor, currency: o.currency }, locale)).join(" + ")}
          </span>
        )}
        {canSendInvoice && familyLink && (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={busy}
              className={cn(ICON_BUTTON, "border-primary/25 bg-primary/10 text-primary hover:bg-primary/18")}
              aria-label={t("family.sendFamilyLink", { count: payable.length })}
              title={t("family.sendFamilyLink", { count: payable.length })}
              data-testid="due-table-family-send"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => void copyLink()}
              className={cn(ICON_BUTTON, "border-border/70 bg-muted/60 text-foreground/80 hover:bg-muted")}
              aria-label={copied ? t("actions.copied") : t("actions.copyMessage")}
              title={copied ? t("actions.copied") : t("actions.copyMessage")}
            >
              {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </button>
          </span>
        )}
      </div>
      {error && <p className="text-destructive text-[11px]">{t("family.linkFailed")}</p>}
    </td>
  );

  return (
    <tbody className={cn("border-t border-border/80 first-of-type:border-t-0", striped && "bg-muted/30")} data-testid={`due-table-family-${family.key}`}>
      {family.rows.map((row, i) => (
        <DueTableRow
          key={row.id}
          row={row}
          familyCell={i === 0 ? familyCell : <td className={CELL} />}
          timezone={timezone}
          payerName={family.name}
          canSendInvoice={canSendInvoice}
          actions={actionProps(row)}
        />
      ))}
    </tbody>
  );
}

function DueTableRow({
  row,
  familyCell,
  timezone,
  payerName,
  canSendInvoice,
  actions,
}: {
  row: LessonPackageRow;
  /** The parent's cell on the family's first line, an empty one after it. */
  familyCell: React.ReactNode;
  timezone: string;
  payerName: string;
  canSendInvoice: boolean;
  actions: PackageActionProps;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { copyable, copied, copyMessage } = useRowPaymentCopy(row, payerName);
  const purpose = row.purpose ?? "NEW";
  const owes = row.outstanding_minor > 0;
  const unbilled = row.invoice_id === null && row.minutes_consumed > 0;
  const remindable = owes || row.awaiting_next_package;
  const usage = `${blockAmount(row.minutes_sold, row.lesson_minutes, t, locale)} · ${t("family.lessonsTaken", { count: row.lesson_count, n: formatNumber(row.lesson_count, locale) })}${row.status !== "ACTIVE" ? ` · ${t(`status.${row.status}`)}` : ""}`;

  return (
    <tr className="hover:bg-primary/[0.04] transition-colors" data-testid="due-table-row">
      {familyCell}

      <td className={CELL}>
        <span className="flex max-w-48 items-center gap-1.5">
          <button type="button" onClick={actions.onOpenDetail} className="hover:text-primary min-w-0 truncate text-start font-medium transition-colors">
            {row.student_name}
          </button>
          <PrepaidChip row={row} />
          {row.gap !== null && (
            <span className="shrink-0 text-rose-600 dark:text-rose-400" title={t("family.gap")} aria-label={t("family.gap")}>
              <AlertTriangle className="size-3.5" aria-hidden />
            </span>
          )}
        </span>
      </td>

      <td className={CELL}>
        <span className={cn("inline-block rounded-md px-1.5 py-px text-[11px] font-semibold", PURPOSE_TONE[purpose])} data-testid="due-table-purpose">
          {purposeText(row, purpose, t)}
        </span>
      </td>

      {/* Which package, and how much of it is used: a short bar, the rest on hover. */}
      <td className={CELL} title={usage} data-testid="due-table-usage">
        <span className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground max-w-36 truncate">
            <span className="text-foreground font-semibold tabular-nums">#{formatNumber(row.sequence_no, locale)}</span>{" "}
            {row.subject ? (row.subject.course ?? row.subject.teacher_name) : row.label}
          </span>
          <span className="bg-muted h-1.5 w-14 shrink-0 overflow-hidden rounded-full" aria-hidden>
            <span
              className={cn("block h-full rounded-full", row.status === "ACTIVE" ? "bg-amber-500" : "bg-rose-500")}
              style={{ width: `${Math.max(0, Math.min(100, row.percent_used))}%` }}
            />
          </span>
        </span>
      </td>

      <td className={cn(CELL, "text-end")}>
        <span className={cn("font-bold tabular-nums", owes ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")} data-testid="due-table-amount">
          {owes
            ? formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale)
            : unbilled
              ? t("family.notBilled")
              : t("card.overdrawn", { over: blockMinutes(row.minutes_overdrawn, row.lesson_minutes, t, locale) })}
        </span>
      </td>

      {/* How long it has waited — and, if any, how many reminders went. */}
      <td className={CELL}>
        <span className="flex items-center gap-1.5">
          <WaitingChip createdAt={row.created_at} />
          {row.reminders_sent > 0 && row.last_reminded_at !== null && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-sky-700 tabular-nums dark:text-sky-300"
              title={t("card.reminders", {
                count: row.reminders_sent,
                n: formatNumber(row.reminders_sent, locale),
                date: formatDateTime(row.last_reminded_at, timezone, locale),
              })}
              data-testid="due-table-reminded"
            >
              <BellRing className="size-3" aria-hidden />
              {formatNumber(row.reminders_sent, locale)}
            </span>
          )}
        </span>
      </td>

      <td className={cn(CELL, "pe-4")}>
        <div className="flex items-center justify-end gap-1">
          {canSendInvoice && remindable && (
            <button
              type="button"
              onClick={actions.onRemind}
              disabled={actions.reminding}
              className={cn(ICON_BUTTON, "border-sky-500/25 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300")}
              aria-label={t("actions.remind")}
              title={t("actions.remind")}
              data-testid="due-table-remind"
            >
              {actions.reminding ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <BellRing className="size-3.5" aria-hidden />}
            </button>
          )}
          {copyable && (
            <button
              type="button"
              onClick={() => void copyMessage()}
              className={cn(ICON_BUTTON, "border-border/70 bg-muted/60 text-foreground/80 hover:bg-muted")}
              aria-label={copied ? t("actions.copied") : t("actions.copyMessage")}
              title={copied ? t("actions.copied") : t("actions.copyMessage")}
            >
              {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className={cn(ICON_BUTTON, "border-border/70 bg-muted/60 text-foreground/80 hover:bg-muted")}
            aria-label={t("actions.history")}
            title={t("actions.history")}
          >
            <History className="size-3.5" aria-hidden />
          </button>
          <PackageActions {...actions} featuredCount={1} hide={DUE_HIDDEN} className="shrink-0" />
        </div>
        <PackageHistoryModal studentId={row.student_id} studentName={row.student_name} open={historyOpen} onClose={() => setHistoryOpen(false)} />
      </td>
    </tr>
  );
}

// ── The Paid tab's table ──────────────────────────────────────────────────────

/**
 * The Due page's Paid tab as the same compact table, one line per package (phones and tablets keep
 * the paid cards): who, the parent, which package, what came in, how, when, the reference, and the
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
