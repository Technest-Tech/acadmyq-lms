"use client";

import { academyTimeZone } from "@/lib/academy-clock";
import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  Clock,
  FileText,
  ListChecks,
  Lock,
  Plus,
  Receipt,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCapability } from "@/lib/capabilities";
import { Octagram } from "@/components/ornaments";
import { ClosePeriodModal } from "@/components/invoices/close-period-modal";
import { DueDateChip } from "@/components/invoices/due-date";
import { InvoiceDetailModal } from "@/components/invoices/invoice-detail-modal";
import { InvoiceRowActions } from "@/components/invoices/invoice-row-actions";
import { QuickBillModal } from "@/components/invoices/quick-bill-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/ui/page-hero";
import {
  DataTable,
  type ColumnDef,
  type FilterDef,
} from "@/components/ui/data-table";
import {
  apiFetch,
  getInvoiceFollowUp,
  getInvoiceSummary,
  toQueryString,
  type DataTableQuery,
  type InvoiceSummary,
  type ListResult,
} from "@/lib/api";
import { type ExcelColumn } from "@/lib/export-excel";
import { avatarTone, initials } from "@/lib/avatar";
import { formatMoney, formatNumber } from "@/lib/money";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";

// ── Invoice list row shape (mirrors the API response) ──────────────────────────

export interface InvoiceRow {
  id: string;
  kind: "AUTO" | "MANUAL";
  payer_name: string;
  payer_type: "GUARDIAN" | "STUDENT";
  period_month: number;
  period_year: number;
  status: "OPEN" | "CLOSED" | "PAID" | "PARTIALLY_PAID" | "VOID";
  total_minor: number;
  amount_paid_minor: number;
  currency: string;
  public_token: string;
  created_at: string;
  /** The family the bill belongs to — the parent even when it is addressed to one child; null for a typed name. */
  guardian_name: string | null;
  /** The children the bill is for (its lines' students, else the family's active children). */
  children: string[];
  /** A hand-made bill still unpaid a day after it was raised (GET /api/invoices/follow-up). */
  needs_follow_up: boolean;
  /** A custom bill nothing is paid on and nothing stands behind — it can be deleted. */
  can_delete?: boolean;
  /** The academy-local day a hand-made bill is to be paid by, if one was set. */
  due_on?: string | null;
  /** What the bill is for: its first line's description, and how many lines it has. */
  description?: string | null;
  line_count?: number;
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<InvoiceRow["status"], string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  CLOSED:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  PARTIALLY_PAID:
    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  VOID: "bg-muted text-muted-foreground",
};

const STATUS_DOT: Record<InvoiceRow["status"], string> = {
  OPEN: "bg-blue-500",
  CLOSED: "bg-amber-500",
  PAID: "bg-emerald-500",
  PARTIALLY_PAID: "bg-orange-500",
  VOID: "bg-muted-foreground/50",
};

function InvoiceStatusBadge({ status }: { status: InvoiceRow["status"] }) {
  const t = useTranslations("invoices");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span
        className={`size-1.5 rounded-full ${STATUS_DOT[status]}`}
        aria-hidden
      />
      {t(`status.${status}`)}
    </span>
  );
}

// ── Period filter helpers ──────────────────────────────────────────────────────

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

// ── Summary strip ─────────────────────────────────────────────────────────────

/** One "label value" pair inside the strip. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</span>
    </span>
  );
}

const Divider = () => <span className="bg-border h-5 w-px shrink-0" aria-hidden />;

/**
 * Every invoice figure in a single line: the counts, then one segment per currency the academy
 * bills in (money is NEVER summed across currencies — 500 EGP + 20 USD is not 520 of anything).
 * The line never wraps; on a narrow screen it scrolls sideways, so no amount is ever truncated.
 */
function SummaryCards({
  summary,
  locale,
}: {
  summary: InvoiceSummary | null;
  locale: string;
}) {
  // A centre's bills stay open however much is paid: what is outstanding is everything still owed.
  const centre = useCapability("centre");
  const t = useTranslations("invoices");

  if (!summary) {
    return (
      <div className="bg-card h-11 animate-pulse rounded-xl border shadow-sm" aria-hidden />
    );
  }

  const numFmt = new Intl.NumberFormat(locale);
  const pctFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const awaiting = summary.counts.CLOSED + summary.counts.PARTIALLY_PAID;

  return (
    <div
      className="bg-card no-scrollbar flex items-center gap-x-4 overflow-x-auto whitespace-nowrap rounded-xl border px-4 py-2.5 shadow-sm"
      data-testid="invoice-summary"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <Receipt className="text-muted-foreground size-4" aria-hidden />
        <Stat label={t("summaryTotal")} value={numFmt.format(summary.counts.all)} />
      </span>
      <Stat label={t("summaryPaid")} value={numFmt.format(summary.counts.PAID)} />
      <Stat label={t("summaryAwaiting")} value={numFmt.format(awaiting)} />

      {summary.money.map((bucket) => {
        const fmt = (minor: number) =>
          formatMoney({ amount: minor, currency: bucket.currency }, locale);
        const rate =
          bucket.billed_minor > 0
            ? Math.round((bucket.collected_minor / bucket.billed_minor) * 100)
            : 0;

        return (
          <span
            key={bucket.currency}
            className="inline-flex shrink-0 items-center gap-x-4"
            data-testid={`currency-total-${bucket.currency}`}
          >
            <Divider />
            <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wide">
              {bucket.currency}
            </span>
            <Stat label={t("summaryBilled")} value={fmt(bucket.billed_minor)} />
            <Stat
              label={t("summaryCollected")}
              value={fmt(bucket.collected_minor)}
              tone="text-emerald-600 dark:text-emerald-400"
            />
            <Stat
              label={t("summaryOutstanding")}
              value={fmt(centre ? bucket.due_minor : bucket.outstanding_minor)}
              tone="text-amber-600 dark:text-amber-400"
            />
            <span className="inline-flex items-center gap-1.5" title={t("summaryCollectionRate")}>
              <span className="bg-muted h-1.5 w-14 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
                />
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {pctFmt.format(rate)}%
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── The hand-made bills' header ───────────────────────────────────────────────

/** "جنيه مصري" for EGP, in the workspace's language; the code itself when the browser has no name. */
function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale.startsWith("ar") ? "ar" : "en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A thin bar: how much of the whole is done. */
function ShareBar({ done, whole, tone, title }: { done: number; whole: number; tone: string; title?: string }) {
  const width = whole > 0 ? Math.max(0, Math.min(100, (done / whole) * 100)) : 0;
  return (
    <span className="bg-muted block h-1.5 overflow-hidden rounded-full" title={title} aria-hidden>
      <span className={cn("block h-full rounded-full", tone)} style={{ width: `${width}%` }} />
    </span>
  );
}

/**
 * One currency's money on its own card (Ahmed 2026-11-17: three tall tiles, each a list of seven
 * currencies, made you read across boxes to put one currency together). What is still owed is the
 * big figure — it is what this screen is for; the bar is how much of what was billed is in, then
 * the two figures behind it. A currency with nothing owed says so in words.
 */
function CurrencyMoneyCard({ bucket, locale }: { bucket: InvoiceSummary["money"][number]; locale: string }) {
  const t = useTranslations("invoices");
  const money = (minor: number) => formatMoney({ amount: minor, currency: bucket.currency }, locale);
  // A hand-made bill is owed from the day it is raised: everything unpaid, open bills included.
  const owed = bucket.due_minor;
  const settled = owed <= 0;
  const rate = bucket.billed_minor > 0 ? Math.round((bucket.collected_minor / bucket.billed_minor) * 100) : 0;

  return (
    <div className="bg-muted/30 flex flex-col rounded-xl border p-3.5" data-testid={`currency-total-${bucket.currency}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="bg-primary/10 text-primary shrink-0 rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wide">
          {bucket.currency}
        </span>
        <span className="text-muted-foreground min-w-0 truncate text-xs">{currencyName(bucket.currency, locale)}</span>
      </div>

      <p className="text-muted-foreground mt-3 text-[11px] font-medium">{t("stats.outstanding")}</p>
      {settled ? (
        <p className="mt-0.5 inline-flex items-center gap-1.5 text-base font-bold text-emerald-700 dark:text-emerald-400">
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          {t("stats.settled")}
        </p>
      ) : (
        <p className="mt-0.5 text-xl leading-tight font-bold break-words text-amber-700 tabular-nums dark:text-amber-300">
          {money(owed)}
        </p>
      )}

      <div className="mt-3">
        <ShareBar
          done={bucket.collected_minor}
          whole={bucket.billed_minor}
          tone="bg-emerald-500"
          title={`${t("summaryCollectionRate")} ${formatNumber(rate, locale)}%`}
        />
      </div>

      <dl className="mt-2 divide-y text-xs">
        <div className="flex items-baseline justify-between gap-3 py-1.5">
          <dt className="text-muted-foreground">{t("summaryCollected")}</dt>
          <dd className="font-semibold break-words text-emerald-700 tabular-nums dark:text-emerald-400">{money(bucket.collected_minor)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 pt-1.5">
          <dt className="text-muted-foreground">{t("stats.billed")}</dt>
          <dd className="font-semibold break-words tabular-nums">{money(bucket.billed_minor)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The hand-made bills at a glance, in one panel: how many bills and how many are paid (a bar), the
 * ones past their date to chase — then one card per currency, money never summed across them.
 * Currencies with money still owed come first.
 */
export function ManualStats({
  summary,
  followUpCount,
  followUpOnly,
  onToggleFollowUp,
}: {
  summary: InvoiceSummary | null;
  followUpCount: number;
  followUpOnly: boolean;
  onToggleFollowUp: () => void;
}) {
  const t = useTranslations("invoices");
  const locale = useLocale();

  if (!summary) {
    return <div className="bg-card h-56 animate-pulse rounded-2xl border shadow-sm" aria-hidden />;
  }

  const num = (n: number) => formatNumber(n, locale);
  const paid = summary.counts.PAID;
  const unpaid = summary.counts.OPEN + summary.counts.CLOSED + summary.counts.PARTIALLY_PAID;
  const buckets = [...summary.money].sort((a, b) => Number(b.due_minor > 0) - Number(a.due_minor > 0));

  return (
    <section className="bg-card rounded-2xl border shadow-sm" data-testid="invoice-summary">
      {/* The bills: how many, how many paid — and the ones to chase. */}
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Receipt className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <p className="text-muted-foreground text-xs font-medium">{t("stats.count")}</p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5">
              <span className="text-2xl leading-none font-bold tabular-nums">{num(summary.counts.all)}</span>
              <span className="text-muted-foreground text-xs">{t("stats.countSplit", { paid: num(paid), unpaid: num(unpaid) })}</span>
            </p>
            <div className="mt-2">
              <ShareBar done={paid} whole={paid + unpaid} tone="bg-emerald-500" />
            </div>
          </div>
        </div>

        {/* Past their date and still unpaid — someone has to chase them. */}
        {followUpCount > 0 && (
          <div
            className="flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 dark:border-red-900/60 dark:bg-red-950/30"
            role="alert"
            title={t("followUpHint")}
            data-testid="manual-follow-up-alert"
          >
            <AlertTriangle className="size-5 shrink-0 text-red-600 dark:text-red-300" aria-hidden />
            <p className="min-w-0 flex-1 text-sm font-semibold text-red-800 dark:text-red-200">
              <span className="me-1.5 text-lg font-bold tabular-nums" aria-label={t("followUpTitle", { count: followUpCount })}>
                {num(followUpCount)}
              </span>
              {t("stats.followUp")}
            </p>
            <button
              type="button"
              onClick={onToggleFollowUp}
              aria-pressed={followUpOnly}
              className={cn(
                "shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                followUpOnly
                  ? "border border-red-300 bg-white text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-transparent dark:text-red-300"
                  : "bg-red-600 text-white hover:bg-red-700",
              )}
              data-testid="manual-follow-up-toggle"
            >
              {followUpOnly ? t("followUpShowAll") : t("followUpShowOnly")}
            </button>
          </div>
        )}
      </div>

      {/* The money, one card per currency. */}
      {buckets.length > 0 && (
        <div className="p-4">
          <p className="text-muted-foreground mb-2.5 text-xs font-medium">{t("stats.byCurrency")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {buckets.map((b) => (
              <CurrencyMoneyCard key={b.currency} bucket={b} locale={locale} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Payer avatar ──────────────────────────────────────────────────────────────

/** The bill reads as the family's: the parent's name, even on a bill addressed to one child. */
function payerLabel(row: InvoiceRow): string {
  return row.guardian_name ?? row.payer_name;
}

function PayerCell({ row }: { row: InvoiceRow }) {
  const t = useTranslations("invoices");
  const name = payerLabel(row);
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm",
          avatarTone(name),
        )}
        aria-hidden
      >
        {initials(name)}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{name}</span>
        <span className="text-muted-foreground text-xs">
          {t(row.guardian_name !== null ? "payerGuardian" : "payerTyped")}
        </span>
      </div>
    </div>
  );
}

function ChildrenCell({ row }: { row: InvoiceRow }) {
  if (row.children.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex max-w-64 flex-wrap gap-1" data-testid={`invoice-children-${row.id}`}>
      {row.children.map((name) => (
        <span key={name} className="bg-muted/60 rounded-full px-2 py-0.5 text-xs font-medium">
          {name}
        </span>
      ))}
    </div>
  );
}

/** When a hand-made bill was raised — and, a day on and still unpaid, a red "follow up" under it. */
function CreatedCell({ row }: { row: InvoiceRow }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const created = new Date(row.created_at);
  const days = Math.max(1, Math.floor((Date.now() - created.getTime()) / 86_400_000));
  return (
    <div className="flex flex-col">
      <span className={cn("tabular-nums", row.needs_follow_up ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>
        {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: academyTimeZone() }).format(created)}
      </span>
      {row.needs_follow_up && (
        <span
          className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400"
          data-testid={`invoice-follow-up-${row.id}`}
        >
          <AlertTriangle className="size-3" aria-hidden />
          {t("followUpRow", { ago: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day") })}
        </span>
      )}
    </div>
  );
}

/** Nothing left to pay on the bill (or it was voided). */
function isSettled(row: InvoiceRow): boolean {
  return row.status === "VOID" || row.status === "PAID" || (row.total_minor > 0 && row.amount_paid_minor >= row.total_minor);
}

/** The bill's total, and under it what is still owed (or "paid in full"). */
function AmountCell({ row }: { row: InvoiceRow }) {
  // A centre's bills stay open however much is paid, so they read by the money on them.
  const centre = useCapability("centre");
  const t = useTranslations("invoices");
  const locale = useLocale();
  // A voided bill owes nothing, whatever its total still says.
  const voided = row.status === "VOID";
  const due = voided ? 0 : Math.max(0, row.total_minor - row.amount_paid_minor);
  return (
    <div className="flex flex-col items-end">
      <span className={cn("font-semibold tabular-nums", voided && "text-muted-foreground line-through")}>
        {formatMoney({ amount: row.total_minor, currency: row.currency }, locale)}
      </span>
      {voided ? (
        <span className="text-muted-foreground text-xs">{t("status.VOID")}</span>
      ) : row.status === "PAID" || (centre && row.total_minor > 0 && due === 0) ? (
        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("paidInFull")}</span>
      ) : (row.status === "CLOSED" || row.status === "PARTIALLY_PAID" || centre) && due > 0 ? (
        <span className="text-xs font-medium text-amber-700 tabular-nums dark:text-amber-300">
          {t("dueAmount", { amount: formatMoney({ amount: due, currency: row.currency }, locale) })}
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">{t(`status.${row.status}`)}</span>
      )}
    </div>
  );
}

/**
 * A hand-made bill in one cell (Ahmed 2026-11-17 — "the most used list now"): who pays, the
 * children it is for, and what it is for (its first line, "+N" when there are more).
 */
function BillCell({ row }: { row: InvoiceRow }) {
  const t = useTranslations("invoices");
  const extra = Math.max(0, (row.line_count ?? 1) - 1);
  return (
    <div className="min-w-0 max-w-sm space-y-1.5">
      <PayerCell row={row} />
      {row.description && (
        <p className="text-foreground/80 ps-12 text-xs leading-snug" data-testid={`invoice-description-${row.id}`}>
          <span className="line-clamp-2">{row.description}</span>
          {extra > 0 && <span className="text-muted-foreground"> · {t("moreLines", { count: extra })}</span>}
        </p>
      )}
      {row.children.length > 0 && (
        <div className="flex flex-wrap gap-1 ps-12">
          {row.children.map((name) => (
            <span key={name} className="bg-muted/60 rounded-full px-2 py-0.5 text-[11px] font-medium">
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One labelled fact on a bill card: every card carries the same rows, so a grid of them lines up. */
function CardFact({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-muted-foreground flex shrink-0 items-center gap-1.5">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0 truncate text-end font-medium">{children}</dd>
    </div>
  );
}

/**
 * A hand-made bill as one small card (Ahmed 2026-11-17: the table read badly — "cards, each small,
 * with the basics", then "tidier, and a good-looking card"). Four fixed zones, the same on every
 * card so a page of them reads as a grid: who pays · the money and how much of it is in · three
 * labelled facts (what for, pay by, raised) · the bill's actions.
 */
function BillCard({ row, onView, onChanged }: { row: InvoiceRow; onView: () => void; onChanged: () => void }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const name = payerLabel(row);
  const money = (amount: number) => formatMoney({ amount, currency: row.currency }, locale);

  // A voided bill owes nothing, whatever its total still says.
  const voided = row.status === "VOID";
  const due = voided ? 0 : Math.max(0, row.total_minor - row.amount_paid_minor);
  const paid = !voided && row.total_minor > 0 && due === 0;
  const paidShare = voided || row.total_minor <= 0 ? 0 : Math.min(100, Math.round((row.amount_paid_minor / row.total_minor) * 100));

  const extra = Math.max(0, (row.line_count ?? 1) - 1);
  const created = new Date(row.created_at);
  const days = Math.max(1, Math.floor((Date.now() - created.getTime()) / 86_400_000));
  const who = [t(row.guardian_name !== null ? "payerGuardian" : "payerTyped"), ...row.children].join(" · ");

  return (
    <div className="flex flex-1 flex-col" data-testid={`invoice-card-${row.id}`}>
      {/* Who pays, and where the bill stands. */}
      <div className="flex items-center gap-3 px-4 pt-4">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm",
            avatarTone(name),
          )}
          aria-hidden
        >
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs" title={who}>
            {who}
          </p>
        </div>
        <span className="shrink-0 self-start">
          <InvoiceStatusBadge status={row.status} />
        </span>
      </div>

      {/* The money: the total, what is still owed, and how much of it is in. */}
      <div className="bg-muted/40 mx-4 mt-3.5 rounded-xl px-3.5 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className={cn("text-xl font-bold break-words tabular-nums", voided && "text-muted-foreground line-through")}>
            {money(row.total_minor)}
          </span>
          {paid ? (
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{t("paidInFull")}</span>
          ) : row.amount_paid_minor > 0 && due > 0 ? (
            <span className="text-xs font-semibold text-amber-700 tabular-nums dark:text-amber-300">
              {t("dueAmount", { amount: money(due) })}
            </span>
          ) : null}
        </div>
        <div className="bg-border/70 mt-2.5 h-1.5 overflow-hidden rounded-full" aria-hidden>
          <div
            className={cn("h-full rounded-full", paid ? "bg-emerald-500" : "bg-amber-500")}
            style={{ width: `${paidShare}%` }}
          />
        </div>
      </div>

      {/* The same three facts on every card. */}
      <dl className="divide-border/60 divide-y px-4 py-1.5 text-xs">
        <CardFact icon={FileText} label={t("liDescription")}>
          {row.description ? (
            <span title={row.description} data-testid={`invoice-description-${row.id}`}>
              {row.description}
              {extra > 0 && <span className="text-muted-foreground font-normal"> · {t("moreLines", { count: extra })}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground font-normal">—</span>
          )}
        </CardFact>
        <CardFact icon={CalendarClock} label={t("due.label")}>
          {row.due_on ? (
            <DueDateChip dueOn={row.due_on} settled={isSettled(row)} testId={`invoice-due-${row.id}`} inline />
          ) : (
            <span className="text-muted-foreground font-normal">{t("due.none")}</span>
          )}
        </CardFact>
        <CardFact icon={Clock} label={t("card.raised")}>
          <span className="tabular-nums">
            {new Intl.DateTimeFormat(numeralLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: academyTimeZone() }).format(created)}
          </span>
        </CardFact>
      </dl>

      {/* What to do with it — and, a day on and still unpaid, that someone has to chase it. */}
      <div className="bg-muted/25 mt-auto flex items-center justify-between gap-2 rounded-b-2xl border-t px-4 py-2.5">
        {row.needs_follow_up ? (
          <span
            className="inline-flex min-w-0 items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400"
            data-testid={`invoice-follow-up-${row.id}`}
          >
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {t("followUpRow", { ago: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day") })}
            </span>
          </span>
        ) : (
          <span aria-hidden />
        )}
        <InvoiceRowActions row={row} onView={onView} onChanged={onChanged} />
      </div>
    </div>
  );
}

/** What the hand-made bills can be sorted by (the cards draw themselves: {@link BillCard}). */
function useManualColumns(): ColumnDef<InvoiceRow>[] {
  const t = useTranslations("invoices");
  return [
    { key: "bill", header: t("colBill"), sortKey: "payer_name", render: (row) => <BillCell row={row} /> },
    {
      key: "due_on",
      header: t("due.label"),
      sortKey: "due_on",
      render: (row) => <DueDateChip dueOn={row.due_on} settled={isSettled(row)} testId={`invoice-due-${row.id}`} />,
    },
    { key: "amount", header: t("colTotal"), sortKey: "total_minor", className: "text-end", render: (row) => <AmountCell row={row} /> },
    { key: "status", header: t("colStatus"), render: (row) => <InvoiceStatusBadge status={row.status} /> },
    { key: "created", header: t("colCreated"), sortKey: "created_at", render: (row) => <CreatedCell row={row} /> },
  ];
}

// ── Shared list columns ──────────────────────────────────────────────────────

/** The automatic invoices' table columns. Row click + the row-actions cluster handle opening /
 *  acting on a bill, so there is no inline action column. The manual tab has its own
 *  ({@link useManualColumns}). */
function useInvoiceColumns(): ColumnDef<InvoiceRow>[] {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }),
    [locale],
  );

  return [
    {
      key: "payer",
      header: t("colGuardian"),
      sortKey: "payer_name",
      render: (row) => <PayerCell row={row} />,
    },
    {
      key: "children",
      header: t("colChildren"),
      render: (row) => <ChildrenCell row={row} />,
    },
    {
      key: "period",
      header: t("colPeriod"),
      sortKey: "period",
      render: (row) => (
        <span className="text-muted-foreground font-medium">
          {monthFmt.format(new Date(row.period_year, row.period_month - 1, 1))}
        </span>
      ),
    },
    {
      key: "status",
      header: t("colStatus"),
      render: (row) => <InvoiceStatusBadge status={row.status} />,
    },
    {
      key: "currency",
      header: t("currency"),
      render: (row) => (
        <span className="text-muted-foreground font-medium tabular-nums">
          {row.currency}
        </span>
      ),
    },
    {
      key: "amount",
      header: t("colTotal"),
      sortKey: "total_minor",
      className: "text-end",
      render: (row) => <AmountCell row={row} />,
    },
  ];
}

/** Export columns for the invoice list — flat values (no badges), shared by both tabs. */
function useInvoiceExportColumns({ manual = false }: { manual?: boolean } = {}): ExcelColumn<InvoiceRow>[] {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }),
    [locale],
  );

  return [
    { header: t("colGuardian"), value: (row) => payerLabel(row), width: 26 },
    { header: t("colChildren"), value: (row) => row.children.join("، "), width: 30 },
    ...(manual
      ? [
          {
            header: t("colCreated"),
            value: (row: InvoiceRow) =>
              new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: academyTimeZone() }).format(new Date(row.created_at)),
            width: 22,
          },
          {
            header: t("followUpColumn"),
            value: (row: InvoiceRow) => (row.needs_follow_up ? t("followUpYes") : ""),
          },
          { header: t("liDescription"), value: (row: InvoiceRow) => row.description ?? "", width: 34 },
          { header: t("due.label"), value: (row: InvoiceRow) => row.due_on ?? "" },
        ]
      : []),
    {
      header: t("colPeriod"),
      value: (row) =>
        monthFmt.format(new Date(row.period_year, row.period_month - 1, 1)),
    },
    { header: t("colStatus"), value: (row) => t(`status.${row.status}`) },
    { header: t("currency"), value: (row) => row.currency },
    {
      header: t("colTotal"),
      value: (row) =>
        formatMoney({ amount: row.total_minor, currency: row.currency }, locale),
    },
    {
      header: t("amountPaid"),
      value: (row) =>
        formatMoney(
          { amount: row.amount_paid_minor, currency: row.currency },
          locale,
        ),
    },
    {
      header: t("balanceDue"),
      value: (row) =>
        formatMoney(
          {
            amount: row.status === "VOID" ? 0 : Math.max(0, row.total_minor - row.amount_paid_minor),
            currency: row.currency,
          },
          locale,
        ),
    },
  ];
}

const STATUS_FILTER_OPTIONS = (
  t: ReturnType<typeof useTranslations>,
  /** A centre's list leaves voided bills out, so this is where they can still be found. */
  centre: boolean,
): FilterDef => ({
  key: "status",
  label: t("filterStatus"),
  options: [
    { value: "OPEN", label: t("status.OPEN") },
    { value: "CLOSED", label: t("status.CLOSED") },
    { value: "PAID", label: t("status.PAID") },
    { value: "PARTIALLY_PAID", label: t("status.PARTIALLY_PAID") },
    ...(centre ? [{ value: "VOID", label: t("status.VOID") }] : []),
  ],
});

const INPUT_CLASS =
  "border-input bg-background focus:border-primary focus:ring-primary/15 h-8 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

// ── Automatic invoices tab (the original Sprint 7 dashboard, scoped to kind=AUTO) ─

function AutomaticTab() {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const { can } = useAuth();
  // A centre's bills never close: there is no month to shut.
  const centre = useCapability("centre");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [periodYear, setPeriodYear] = useState<string>(() =>
    String(new Date().getFullYear()),
  );
  const [periodMonth, setPeriodMonth] = useState<string>(() =>
    String(new Date().getMonth() + 1),
  );
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const refreshAll = useCallback(() => setRefreshToken((n) => n + 1), []);
  const columns = useInvoiceColumns();
  const exportColumns = useInvoiceExportColumns();

  // Summary tracks the active period filters + the global refresh token (kind=AUTO).
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    getInvoiceSummary({
      kind: "AUTO",
      ...(periodYear ? { period_year: periodYear } : {}),
      ...(periodMonth ? { period_month: periodMonth } : {}),
    })
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch(() => {
        if (!cancelled)
          setSummary({
            counts: { all: 0, OPEN: 0, CLOSED: 0, PAID: 0, PARTIALLY_PAID: 0 },
            money: [],
          });
      });
    return () => {
      cancelled = true;
    };
  }, [periodYear, periodMonth, refreshToken]);

  const fetcher = useCallback(
    (q: DataTableQuery): Promise<ListResult<InvoiceRow>> => {
      const merged: DataTableQuery = {
        ...q,
        filter: {
          ...(q.filter ?? {}),
          kind: "AUTO",
          ...(periodYear ? { period_year: periodYear } : {}),
          ...(periodMonth ? { period_month: periodMonth } : {}),
        },
      };
      return apiFetch(`/api/invoices${toQueryString(merged)}`);
    },
    [periodYear, periodMonth],
  );

  return (
    <div className="space-y-6">
      {can("invoice.close") && !centre && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCloseOpen(true)}
          >
            <Lock className="size-3.5" aria-hidden />
            {t("closePeriod")}
          </Button>
        </div>
      )}

      {flash && (
        <AlertBanner
          variant="success"
          message={flash}
          onDismiss={() => setFlash(null)}
        />
      )}

      <SummaryCards summary={summary} locale={locale} />

      {/* Period selectors (outside DataTable's built-in filters) */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("filterYear")}
          value={periodYear}
          onChange={(e) => setPeriodYear(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">{t("filterYear")}</option>
          {YEARS.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterMonth")}
          value={periodMonth}
          onChange={(e) => setPeriodMonth(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">{t("filterMonth")}</option>
          {MONTHS.map((m) => (
            <option key={m} value={String(m)}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
      </div>

      {/* ── Panel ────────────────────────────────────────────────────── */}
      <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="relative border-b">
          <div className="from-primary/[0.07] via-primary/[0.025] flex items-center gap-3 bg-gradient-to-r to-transparent px-5 py-4">
            <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
              <Receipt className="text-primary size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                {t("panelAuto")}
                <Octagram className="text-gold/60 size-2 shrink-0" />
              </h2>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {t("panelAutoHint")}
              </p>
            </div>
          </div>
          <span
            className="via-gold/45 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
            aria-hidden
          />
        </div>
        <div className="p-4">
        <DataTable<InvoiceRow>
          fetcher={fetcher}
          columns={columns}
          getRowId={(row) => row.id}
          searchable
          filters={[STATUS_FILTER_OPTIONS(t, centre)]}
          defaultSort="-period"
          onRowClick={(row) => setSelectedId(row.id)}
          rowActions={(row) => (
            <InvoiceRowActions
              row={row}
              onView={() => setSelectedId(row.id)}
              onChanged={refreshAll}
            />
          )}
          emptyMessage={t("empty")}
          testId="invoices-table"
          exportConfig={{
            fileName: "invoices-automatic",
            sheetName: t("tabs.auto"),
            columns: exportColumns,
          }}
          refreshToken={refreshToken}
        />
        </div>
      </section>

      <InvoiceDetailModal
        invoiceId={selectedId}
        onClose={() => {
          setSelectedId(null);
          refreshAll();
        }}
      />

      <ClosePeriodModal
        open={closeOpen}
        defaultYear={periodYear ? Number(periodYear) : undefined}
        defaultMonth={periodMonth ? Number(periodMonth) : undefined}
        onClose={() => setCloseOpen(false)}
        onSuccess={(closed, period) => {
          setCloseOpen(false);
          setFlash(t("closePeriodSuccess", { count: closed, period }));
          refreshAll();
        }}
      />
    </div>
  );
}

// ── Manual invoices tab (create + list operator-driven bills, kind=MANUAL) ────────

function ManualTab({
  followUpCount,
  onChanged,
  createOpen,
  setCreateOpen,
}: {
  /** Hand-made bills unpaid a day after they were raised (owned by the screen — the tab shows it too). */
  followUpCount: number;
  onChanged: () => void;
  /** The "new bill" form: its button sits on the screen's tab row, so the screen holds the switch. */
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}) {
  const centre = useCapability("centre");
  const t = useTranslations("invoices");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [followUpOnly, setFollowUpOnly] = useState(false);

  const refreshAll = useCallback(() => {
    setRefreshToken((n) => n + 1);
    onChanged();
  }, [onChanged]);
  // Stable: the modal holds text inputs, and a fresh onClose each render steals their focus.
  const closeCreate = useCallback(() => setCreateOpen(false), [setCreateOpen]);
  const columns = useManualColumns();
  const exportColumns = useInvoiceExportColumns({ manual: true });
  const dueFilter: FilterDef = {
    key: "due",
    label: t("due.filter"),
    options: [
      { value: "overdue", label: t("due.filterOverdue") },
      { value: "upcoming", label: t("due.filterUpcoming") },
      { value: "none", label: t("due.filterNone") },
    ],
  };

  // Nothing left to chase ⇒ the "only these" view has nothing to show either.
  useEffect(() => {
    if (followUpCount === 0) setFollowUpOnly(false);
  }, [followUpCount]);

  // Manual-only summary, refreshed alongside the list after every mutation.
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    getInvoiceSummary({ kind: "MANUAL" })
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch(() => {
        if (!cancelled)
          setSummary({
            counts: { all: 0, OPEN: 0, CLOSED: 0, PAID: 0, PARTIALLY_PAID: 0 },
            money: [],
          });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const fetcher = useCallback(
    (q: DataTableQuery): Promise<ListResult<InvoiceRow>> => {
      const merged: DataTableQuery = {
        ...q,
        filter: { ...(q.filter ?? {}), kind: "MANUAL", ...(followUpOnly ? { follow_up: "1" } : {}) },
      };
      return apiFetch(`/api/invoices${toQueryString(merged)}`);
    },
    [followUpOnly],
  );

  return (
    <div className="space-y-4">
      <ManualStats
        summary={summary}
        followUpCount={followUpCount}
        followUpOnly={followUpOnly}
        onToggleFollowUp={() => setFollowUpOnly((v) => !v)}
      />

        <DataTable<InvoiceRow>
          fetcher={fetcher}
          columns={columns}
          getRowId={(row) => row.id}
          searchable
          filters={[STATUS_FILTER_OPTIONS(t, centre), dueFilter]}
          defaultSort="-created_at"
          onRowClick={(row) => setSelectedId(row.id)}
          rowClassName={(row) =>
            row.needs_follow_up ? "border-red-300 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20" : undefined
          }
          renderCard={(row) => <BillCard row={row} onView={() => setSelectedId(row.id)} onChanged={refreshAll} />}
          emptyMessage={t("manualEmpty")}
          testId="manual-invoices-table"
          exportConfig={{
            fileName: "invoices-manual",
            sheetName: t("tabs.manual"),
            columns: exportColumns,
          }}
          refreshToken={refreshToken}
        />

      <QuickBillModal
        open={createOpen}
        onClose={closeCreate}
        onCreated={refreshAll}
        onView={(id) => {
          setCreateOpen(false);
          setSelectedId(id);
        }}
      />

      <InvoiceDetailModal
        invoiceId={selectedId}
        onClose={() => {
          setSelectedId(null);
          refreshAll();
        }}
      />
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

type Tab = "auto" | "manual";

// Hand-made bills lead (Ahmed 2026-11-17): they are where the daily work is now.
const TABS: ReadonlyArray<{ key: Tab; icon: typeof Sparkles }> = [
  { key: "manual", icon: ListChecks },
  { key: "auto", icon: Sparkles },
];

/**
 * Invoices screen (Sprint 7 + Sprint 9). Permission-gated by invoice.read. Two tabs: manual
 * bills (operator-created; first and open by default since 2026-11-17) and automatic monthly
 * invoices (generated from billable sessions).
 */
export function InvoicesScreen() {
  const t = useTranslations("invoices");
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("manual");
  const [createOpen, setCreateOpen] = useState(false);
  const [followUpCount, setFollowUpCount] = useState(0);
  const [followUpToken, setFollowUpToken] = useState(0);
  const refreshFollowUp = useCallback(() => setFollowUpToken((n) => n + 1), []);
  const canRead = can("invoice.read");

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    getInvoiceFollowUp()
      .then((r) => !cancelled && setFollowUpCount(r.count))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canRead, followUpToken, tab]);

  if (!canRead) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="invoices-hero-lattice"
        icon={Receipt}
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {/* Segmented tabs, and at the row's end the open tab's own action. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        role="tablist"
        aria-label={t("title")}
        className="bg-card flex min-w-full flex-1 gap-1 rounded-2xl border p-1.5 shadow-sm sm:max-w-md sm:min-w-0"
      >
        {TABS.map(({ key, icon: Icon }) => {
          const selected = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              data-testid={`invoices-tab-${key}`}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
                selected
                  ? "bg-primary/10 text-primary ring-primary/20 ring-1"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {/* The gold thread marks the open tab — the frame's own way of saying "here". */}
              {selected && (
                <span
                  className="via-gold absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
                  aria-hidden
                />
              )}
              <Icon className="size-4" aria-hidden />
              <span>{t(`tabs.${key}`)}</span>
              {key === "manual" && followUpCount > 0 && (
                <span
                  className="bg-destructive inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white tabular-nums"
                  aria-label={t("followUpTitle", { count: followUpCount })}
                  data-testid="manual-tab-follow-up"
                >
                  {followUpCount > 99 ? "99+" : followUpCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
        {tab === "manual" && can("invoice.create") && (
          <Button type="button" size="lg" onClick={() => setCreateOpen(true)} data-testid="manual-new-bill">
            <Plus className="size-4" aria-hidden />
            {t("manualNew")}
          </Button>
        )}
      </div>

      <div role="tabpanel" aria-label={t(`tabs.${tab}`)}>
        {tab === "auto" ? (
          <AutomaticTab />
        ) : (
          <ManualTab followUpCount={followUpCount} onChanged={refreshFollowUp} createOpen={createOpen} setCreateOpen={setCreateOpen} />
        )}
      </div>
    </div>
  );
}
