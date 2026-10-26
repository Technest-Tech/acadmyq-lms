"use client";

import {
  AlertTriangle,
  FilePlus2,
  ListChecks,
  Lock,
  Plus,
  Receipt,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Octagram } from "@/components/ornaments";
import { ClosePeriodModal } from "@/components/invoices/close-period-modal";
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
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Invoice list row shape (mirrors the API response) ──────────────────────────

export interface InvoiceRow {
  id: string;
  kind: "AUTO" | "MANUAL";
  payer_name: string;
  payer_type: "GUARDIAN" | "STUDENT";
  period_month: number;
  period_year: number;
  status: "OPEN" | "CLOSED" | "PAID" | "PARTIALLY_PAID";
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
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<InvoiceRow["status"], string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  CLOSED:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  PARTIALLY_PAID:
    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
};

const STATUS_DOT: Record<InvoiceRow["status"], string> = {
  OPEN: "bg-blue-500",
  CLOSED: "bg-amber-500",
  PAID: "bg-emerald-500",
  PARTIALLY_PAID: "bg-orange-500",
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
              value={fmt(bucket.outstanding_minor)}
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

// ── Payer avatar ──────────────────────────────────────────────────────────────

const AVATAR_TONES = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const ini = parts
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return ini || "?";
}

function avatarTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

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
        {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(created)}
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

// ── Shared list columns ──────────────────────────────────────────────────────

/** The invoice table columns, shared by both tabs. Row click + the row-actions
 *  cluster handle opening / acting on a bill, so there is no inline action column.
 *  The manual tab adds when each bill was raised (its follow-up clock). */
function useInvoiceColumns({ manual = false }: { manual?: boolean } = {}): ColumnDef<InvoiceRow>[] {
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
    ...(manual
      ? [
          {
            key: "created",
            header: t("colCreated"),
            sortKey: "created_at",
            render: (row: InvoiceRow) => <CreatedCell row={row} />,
          },
        ]
      : []),
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
      render: (row) => {
        const due = Math.max(0, row.total_minor - row.amount_paid_minor);
        return (
          <div className="flex flex-col items-end">
            <span className="font-semibold tabular-nums">
              {formatMoney(
                { amount: row.total_minor, currency: row.currency },
                locale,
              )}
            </span>
            {row.status === "PAID" ? (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {t("paidInFull")}
              </span>
            ) : (row.status === "CLOSED" || row.status === "PARTIALLY_PAID") &&
              due > 0 ? (
              <span className="text-xs font-medium text-amber-700 tabular-nums dark:text-amber-300">
                {t("dueAmount", {
                  amount: formatMoney(
                    { amount: due, currency: row.currency },
                    locale,
                  ),
                })}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">
                {t(`status.${row.status}`)}
              </span>
            )}
          </div>
        );
      },
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
              new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.created_at)),
            width: 22,
          },
          {
            header: t("followUpColumn"),
            value: (row: InvoiceRow) => (row.needs_follow_up ? t("followUpYes") : ""),
          },
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
            amount: Math.max(0, row.total_minor - row.amount_paid_minor),
            currency: row.currency,
          },
          locale,
        ),
    },
  ];
}

const STATUS_FILTER_OPTIONS = (
  t: ReturnType<typeof useTranslations>,
): FilterDef => ({
  key: "status",
  label: t("filterStatus"),
  options: [
    { value: "OPEN", label: t("status.OPEN") },
    { value: "CLOSED", label: t("status.CLOSED") },
    { value: "PAID", label: t("status.PAID") },
    { value: "PARTIALLY_PAID", label: t("status.PARTIALLY_PAID") },
  ],
});

const INPUT_CLASS =
  "border-input bg-background focus:border-primary focus:ring-primary/15 h-8 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

// ── Automatic invoices tab (the original Sprint 7 dashboard, scoped to kind=AUTO) ─

function AutomaticTab() {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const { can } = useAuth();

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
      {can("invoice.close") && (
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
          filters={[STATUS_FILTER_OPTIONS(t)]}
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
}: {
  /** Hand-made bills unpaid a day after they were raised (owned by the screen — the tab shows it too). */
  followUpCount: number;
  onChanged: () => void;
}) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const { can } = useAuth();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [followUpOnly, setFollowUpOnly] = useState(false);

  const refreshAll = useCallback(() => {
    setRefreshToken((n) => n + 1);
    onChanged();
  }, [onChanged]);
  // Stable: the modal holds text inputs, and a fresh onClose each render steals their focus.
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const columns = useInvoiceColumns({ manual: true });
  const exportColumns = useInvoiceExportColumns({ manual: true });

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
    <div className="space-y-6">
      {/* Create CTA banner */}
      <div className="from-primary/[0.07] to-card flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-gradient-to-br p-5 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
            <FilePlus2 className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">
              {t("manualSectionTitle")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("manualListHint")}
            </p>
          </div>
        </div>
        {can("invoice.create") && (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t("manualNew")}
          </Button>
        )}
      </div>

      {/* Bills a day old and still unpaid — someone has to chase them. */}
      {followUpCount > 0 && (
        <div
          className="flex flex-col gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-red-900/60 dark:bg-red-950/30"
          role="alert"
          data-testid="manual-follow-up-alert"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                {t("followUpTitle", { count: followUpCount })}
              </p>
              <p className="text-sm text-red-700/90 dark:text-red-300/90">{t("followUpHint")}</p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={followUpOnly ? "outline" : "destructive"}
            className="shrink-0"
            onClick={() => setFollowUpOnly((v) => !v)}
            data-testid="manual-follow-up-toggle"
          >
            {followUpOnly ? t("followUpShowAll") : t("followUpShowOnly")}
          </Button>
        </div>
      )}

      <SummaryCards summary={summary} locale={locale} />

      {/* ── Panel ────────────────────────────────────────────────────── */}
      <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="relative border-b">
          <div className="from-primary/[0.07] via-primary/[0.025] flex items-center gap-3 bg-gradient-to-r to-transparent px-5 py-4">
            <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
              <FilePlus2 className="text-primary size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                {t("panelManual")}
                <Octagram className="text-gold/60 size-2 shrink-0" />
              </h2>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {t("panelManualHint")}
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
          filters={[STATUS_FILTER_OPTIONS(t)]}
          defaultSort="-created_at"
          onRowClick={(row) => setSelectedId(row.id)}
          rowClassName={(row) => (row.needs_follow_up ? "bg-red-50/70 dark:bg-red-950/20" : undefined)}
          rowActions={(row) => (
            <InvoiceRowActions
              row={row}
              onView={() => setSelectedId(row.id)}
              onChanged={refreshAll}
            />
          )}
          emptyMessage={t("manualEmpty")}
          testId="manual-invoices-table"
          exportConfig={{
            fileName: "invoices-manual",
            sheetName: t("tabs.manual"),
            columns: exportColumns,
          }}
          refreshToken={refreshToken}
        />
        </div>
      </section>

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

const TABS: ReadonlyArray<{ key: Tab; icon: typeof Sparkles }> = [
  { key: "auto", icon: Sparkles },
  { key: "manual", icon: ListChecks },
];

/**
 * Invoices screen (Sprint 7 + Sprint 9). Permission-gated by invoice.read. Two tabs:
 * automatic monthly invoices (generated from billable sessions) and manual bills
 * (operator-created itemized or advance-payment invoices).
 */
export function InvoicesScreen() {
  const t = useTranslations("invoices");
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("auto");
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

      {/* Segmented tabs */}
      <div
        role="tablist"
        aria-label={t("title")}
        className="bg-card flex gap-1 rounded-2xl border p-1.5 shadow-sm sm:max-w-md"
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

      <div role="tabpanel" aria-label={t(`tabs.${tab}`)}>
        {tab === "auto" ? <AutomaticTab /> : <ManualTab followUpCount={followUpCount} onChanged={refreshFollowUp} />}
      </div>
    </div>
  );
}
