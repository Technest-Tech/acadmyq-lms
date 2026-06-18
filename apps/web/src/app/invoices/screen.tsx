"use client";

import {
  Clock,
  FilePlus2,
  ListChecks,
  Lock,
  Plus,
  Receipt,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ClosePeriodModal } from "@/components/invoices/close-period-modal";
import { InvoiceDetailModal } from "@/components/invoices/invoice-detail-modal";
import { InvoiceRowActions } from "@/components/invoices/invoice-row-actions";
import { ManualBillModal } from "@/components/invoices/manual-bill-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type ColumnDef,
  type FilterDef,
} from "@/components/ui/data-table";
import {
  apiFetch,
  getInvoiceSummary,
  toQueryString,
  type DataTableQuery,
  type InvoiceSummary,
  type ListResult,
} from "@/lib/api";
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

// ── Summary stat cards ─────────────────────────────────────────────────────────

type Tone = "primary" | "amber" | "emerald" | "blue";

const TONE_ICON: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  emerald:
    "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
};

const TONE_BAR: Record<Tone, string> = {
  primary: "bg-primary",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
};

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  progress,
}: {
  icon: typeof Wallet;
  tone: Tone;
  label: string;
  value: string;
  sub?: string;
  /** 0–100; when set, renders a thin progress bar instead of the sub line. */
  progress?: number;
}) {
  return (
    <div className="group bg-card relative overflow-hidden rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.03] transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[0.7rem] font-semibold uppercase tracking-wider">
            {label}
          </p>
          <p className="mt-2 truncate text-2xl font-bold tracking-tight tabular-nums">
            {value}
          </p>
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            TONE_ICON[tone],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
      </div>
      {progress !== undefined ? (
        <div className="mt-3.5">
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                TONE_BAR[tone],
              )}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        </div>
      ) : sub ? (
        <p className="text-muted-foreground mt-3 truncate text-xs">{sub}</p>
      ) : (
        <div className="mt-3 h-4" aria-hidden />
      )}
    </div>
  );
}

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-card h-[116px] animate-pulse rounded-2xl border shadow-sm"
            aria-hidden
          />
        ))}
      </div>
    );
  }

  const primary = summary.money[0] ?? null;
  const moreCurrencies = Math.max(0, summary.money.length - 1);
  const moreNote =
    moreCurrencies > 0
      ? t("moreCurrencies", { count: moreCurrencies })
      : undefined;

  const fmt = (minor: number) =>
    primary
      ? formatMoney({ amount: minor, currency: primary.currency }, locale)
      : "—";

  const awaiting = summary.counts.CLOSED + summary.counts.PARTIALLY_PAID;
  const numFmt = new Intl.NumberFormat(locale);
  const pctFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  const billed = primary?.billed_minor ?? 0;
  const collected = primary?.collected_minor ?? 0;
  const rate = billed > 0 ? Math.round((collected / billed) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={Receipt}
        tone="primary"
        label={t("summaryBilled")}
        value={primary ? fmt(billed) : "—"}
        sub={
          moreNote ??
          `${numFmt.format(summary.counts.all)} · ${t("summaryTotal")}`
        }
      />
      <StatCard
        icon={Wallet}
        tone="emerald"
        label={t("summaryCollected")}
        value={primary ? fmt(collected) : "—"}
        sub={
          moreNote ??
          `${numFmt.format(summary.counts.PAID)} · ${t("summaryPaid")}`
        }
      />
      <StatCard
        icon={Clock}
        tone="amber"
        label={t("summaryOutstanding")}
        value={primary ? fmt(primary.outstanding_minor) : "—"}
        sub={`${numFmt.format(awaiting)} · ${t("summaryAwaiting")}`}
      />
      <StatCard
        icon={TrendingUp}
        tone="blue"
        label={t("summaryCollectionRate")}
        value={`${pctFmt.format(rate)}%`}
        progress={rate}
      />
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

function PayerCell({ row }: { row: InvoiceRow }) {
  const t = useTranslations("invoices");
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm",
          avatarTone(row.payer_name),
        )}
        aria-hidden
      >
        {initials(row.payer_name)}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{row.payer_name}</span>
        <span className="text-muted-foreground text-xs">
          {t(row.payer_type === "GUARDIAN" ? "payerGuardian" : "payerStudent")}
        </span>
      </div>
    </div>
  );
}

// ── Shared list columns ──────────────────────────────────────────────────────

/** The invoice table columns, shared by both tabs. Row click + the row-actions
 *  cluster handle opening / acting on a bill, so there is no inline action column. */
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
      header: t("colStudent"),
      sortKey: "payer_name",
      render: (row) => <PayerCell row={row} />,
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
        refreshToken={refreshToken}
      />

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

function ManualTab() {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const { can } = useAuth();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refreshAll = useCallback(() => setRefreshToken((n) => n + 1), []);
  const columns = useInvoiceColumns();

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
        filter: { ...(q.filter ?? {}), kind: "MANUAL" },
      };
      return apiFetch(`/api/invoices${toQueryString(merged)}`);
    },
    [],
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

      {flash && (
        <AlertBanner
          variant="success"
          message={flash}
          onDismiss={() => setFlash(null)}
        />
      )}

      <SummaryCards summary={summary} locale={locale} />

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
        emptyMessage={t("manualEmpty")}
        testId="manual-invoices-table"
        refreshToken={refreshToken}
      />

      <ManualBillModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          setFlash(t("manualCreated"));
          refreshAll();
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

  if (!can("invoice.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
      </div>

      {/* Segmented tabs */}
      <div
        role="tablist"
        aria-label={t("title")}
        className="flex gap-1 rounded-2xl border bg-muted/40 p-1.5 shadow-sm sm:max-w-md"
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
                "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
                selected
                  ? "bg-card text-foreground shadow-sm ring-1 ring-black/5"
                  : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span>{t(`tabs.${key}`)}</span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={t(`tabs.${tab}`)}>
        {tab === "auto" ? <AutomaticTab /> : <ManualTab />}
      </div>
    </div>
  );
}
