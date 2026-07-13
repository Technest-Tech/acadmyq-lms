"use client";

import {
  Clock,
  Lock,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { FinalizePeriodModal } from "@/components/payroll/finalize-period-modal";
import { PayoutDetailModal } from "@/components/payroll/payout-detail-modal";
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
  getProfitSummary,
  toQueryString,
  type DataTableQuery,
  type InvoiceSummary,
  type ListResult,
  type PayoutRow,
  type ProfitSummary,
} from "@/lib/api";
import { type ExcelColumn } from "@/lib/export-excel";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<PayoutRow["status"], string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  FINALIZED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

const STATUS_DOT: Record<PayoutRow["status"], string> = {
  OPEN: "bg-blue-500",
  FINALIZED: "bg-emerald-500",
};

function PayoutStatusBadge({ status }: { status: PayoutRow["status"] }) {
  const t = useTranslations("payroll");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {t(`status.${status}`)}
    </span>
  );
}

// ── Period filter helpers ──────────────────────────────────────────────────────

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

// ── Profit summary (owner only) — premium per-currency cards ─────────────────────

function ProfitSummaryPanel({
  year,
  month,
  refreshToken,
}: {
  year: number;
  month: number;
  refreshToken: number;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const [summary, setSummary] = useState<ProfitSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    getProfitSummary(year, month)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch(() => {
        if (!cancelled) setSummary({ year, month, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [year, month, refreshToken]);

  if (!summary) {
    return (
      <div className="bg-card h-[120px] animate-pulse rounded-2xl border shadow-sm" aria-hidden />
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="text-primary size-4" aria-hidden />
        <h2 className="text-sm font-semibold">{t("profitTitle")}</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {String(month).padStart(2, "0")}/{year}
        </span>
      </div>

      {summary.rows.length === 0 ? (
        <div className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
          {t("profitEmpty")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {summary.rows.map((r) => {
            const positive = r.profit_minor >= 0;
            const margin =
              r.revenue_minor > 0
                ? Math.round((r.profit_minor / r.revenue_minor) * 100)
                : 0;
            return (
              <div
                key={r.currency}
                className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.06] via-card to-card p-4 shadow-sm ring-1 ring-foreground/[0.04]"
              >
                <div className="flex items-center justify-between">
                  <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tracking-wide">
                    {r.currency}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
                      positive
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {positive ? (
                      <TrendingUp className="size-3.5" aria-hidden />
                    ) : (
                      <TrendingDown className="size-3.5" aria-hidden />
                    )}
                    {margin}%
                  </span>
                </div>

                <p className="text-muted-foreground mt-3 text-xs font-medium">
                  {t("profitNet")}
                </p>
                <p
                  className={cn(
                    "text-2xl font-extrabold tracking-tight tabular-nums",
                    positive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400",
                  )}
                >
                  {formatMoney({ amount: r.profit_minor, currency: r.currency }, locale)}
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">{t("profitRevenue")}</p>
                    <p className="font-semibold tabular-nums">
                      {formatMoney({ amount: r.revenue_minor, currency: r.currency }, locale)}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-muted-foreground">{t("profitPayouts")}</p>
                    <p className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                      {formatMoney({ amount: r.payouts_minor, currency: r.currency }, locale)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Outstanding dues (owner only) — per-currency amounts owed until now ──────────

/**
 * Per-currency cards for the total still owed "until now" — the unpaid portion of every
 * CLOSED / PARTIALLY_PAID invoice across all periods. Fed by an unfiltered invoice summary,
 * so it is independent of the period filter (unlike the profit summary above).
 */
function DueSummaryPanel({ refreshToken }: { refreshToken: number }) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const [money, setMoney] = useState<InvoiceSummary["money"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMoney(null);
    getInvoiceSummary({})
      .then((res) => {
        if (!cancelled) setMoney(res.money);
      })
      .catch(() => {
        if (!cancelled) setMoney([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  if (!money) {
    return (
      <div className="bg-card h-[120px] animate-pulse rounded-2xl border shadow-sm" aria-hidden />
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="text-primary size-4" aria-hidden />
        <h2 className="text-sm font-semibold">{t("duesTitle")}</h2>
        <span className="text-muted-foreground text-xs">{t("duesHint")}</span>
      </div>

      {money.length === 0 ? (
        <div className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
          {t("duesEmpty")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {money.map((bucket) => {
            const fmt = (v: number) =>
              formatMoney({ amount: v, currency: bucket.currency }, locale);
            const hasDue = bucket.due_minor > 0;

            return (
              <div
                key={bucket.currency}
                className="bg-card relative overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]"
              >
                <div className="flex items-center justify-between">
                  <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tracking-wide">
                    {bucket.currency}
                  </span>
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-xl",
                      hasDue
                        ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
                    )}
                  >
                    <Clock className="size-4.5" aria-hidden />
                  </span>
                </div>

                <p className="text-muted-foreground mt-3 text-xs font-medium">
                  {t("dueLabel")}
                </p>
                <p
                  className={cn(
                    "text-2xl font-extrabold tracking-tight tabular-nums",
                    hasDue
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {fmt(bucket.due_minor)}
                </p>
                <p className="text-muted-foreground mt-2 truncate text-xs">
                  {hasDue
                    ? t("dueOfBilled", { billed: fmt(bucket.billed_minor) })
                    : t("dueSettled")}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

/**
 * Premium payroll dashboard (Sprint 8+). Owners (payout.read) see all teachers' payouts, the
 * per-currency profit summary, the period-finalize action, and can add rewards/deductions to
 * open statements. Teachers (payout.read_own) see only their own statements. The API enforces
 * both scopes for real.
 */
export function PayrollScreen() {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const { can } = useAuth();

  const isOwner = can("payout.read");
  const isTeacher = !isOwner && can("payout.read_own");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [periodYear, setPeriodYear] = useState<string>(() =>
    String(new Date().getFullYear()),
  );
  const [periodMonth, setPeriodMonth] = useState<string>(() =>
    String(new Date().getMonth() + 1),
  );
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const refreshAll = useCallback(() => setRefreshToken((n) => n + 1), []);

  const fetcher = useCallback(
    (q: DataTableQuery): Promise<ListResult<PayoutRow>> => {
      const merged: DataTableQuery = {
        ...q,
        filter: {
          ...(q.filter ?? {}),
          ...(periodYear ? { period_year: periodYear } : {}),
          ...(periodMonth ? { period_month: periodMonth } : {}),
        },
      };
      const base = isOwner ? "/api/payouts" : "/api/me/payouts";
      return apiFetch(`${base}${toQueryString(merged)}`);
    },
    [periodYear, periodMonth, isOwner],
  );

  if (!isOwner && !isTeacher) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const now = new Date();
  const summaryYear = periodYear ? Number(periodYear) : now.getFullYear();
  const summaryMonth = periodMonth ? Number(periodMonth) : now.getMonth() + 1;

  const columns: ColumnDef<PayoutRow>[] = [
    ...(isOwner
      ? [
          {
            key: "teacher",
            header: t("colTeacher"),
            sortKey: "teacher_name",
            render: (row: PayoutRow) => (
              <div className="flex items-center gap-2.5">
                <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                  {initials(row.teacher_name)}
                </span>
                <span className="font-medium">{row.teacher_name ?? "—"}</span>
              </div>
            ),
          } satisfies ColumnDef<PayoutRow>,
        ]
      : []),
    {
      key: "status",
      header: t("colStatus"),
      render: (row) => <PayoutStatusBadge status={row.status} />,
    },
    {
      key: "total",
      header: t("colTotal"),
      sortKey: "total_minor",
      className: "text-end",
      render: (row) => (
        <span
          className={cn(
            "font-bold tabular-nums",
            row.total_minor < 0 && "text-red-600 dark:text-red-400",
          )}
        >
          {formatMoney({ amount: row.total_minor, currency: row.currency }, locale)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      render: (row) => (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(row.id);
          }}
        >
          {t("view")}
        </Button>
      ),
    },
  ];

  const exportColumns: ExcelColumn<PayoutRow>[] = [
    ...(isOwner
      ? [
          {
            header: t("colTeacher"),
            value: (row: PayoutRow) => row.teacher_name ?? "",
            width: 24,
          } satisfies ExcelColumn<PayoutRow>,
        ]
      : []),
    {
      header: t("colPeriod"),
      value: (row) =>
        `${String(row.period_month).padStart(2, "0")}/${row.period_year}`,
    },
    { header: t("colStatus"), value: (row) => t(`status.${row.status}`) },
    {
      header: t("colTotal"),
      value: (row) =>
        formatMoney({ amount: row.total_minor, currency: row.currency }, locale),
    },
  ];

  const statusFilter: FilterDef = {
    key: "status",
    label: t("filterStatus"),
    options: [
      { value: "OPEN", label: t("status.OPEN") },
      { value: "FINALIZED", label: t("status.FINALIZED") },
    ],
  };

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 h-8 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

  return (
    <div className="space-y-6">
      {/* Premium hero header */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.10] via-card to-card p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
              <Wallet className="size-5.5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {isOwner ? t("subtitle") : t("subtitleTeacher")}
              </p>
            </div>
          </div>
          {isOwner && can("payout.finalize") && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFinalizeOpen(true)}
            >
              <Lock className="size-3.5" aria-hidden />
              {t("finalizePeriod")}
            </Button>
          )}
        </div>
      </div>

      {flash && (
        <AlertBanner
          variant="success"
          message={flash}
          onDismiss={() => setFlash(null)}
        />
      )}

      {/* Profit summary — owner only */}
      {isOwner && (
        <ProfitSummaryPanel
          year={summaryYear}
          month={summaryMonth}
          refreshToken={refreshToken}
        />
      )}

      {/* Outstanding dues (all-time, per currency) — owner only */}
      {isOwner && <DueSummaryPanel refreshToken={refreshToken} />}

      {/* Period selectors */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("filterYear")}
          value={periodYear}
          onChange={(e) => setPeriodYear(e.target.value)}
          className={inputClass}
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
          className={inputClass}
        >
          <option value="">{t("filterMonth")}</option>
          {MONTHS.map((m) => (
            <option key={m} value={String(m)}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
      </div>

      <DataTable<PayoutRow>
        fetcher={fetcher}
        columns={columns}
        getRowId={(row) => row.id}
        filters={isOwner ? [statusFilter] : []}
        defaultSort="-period"
        onRowClick={(row) => setSelectedId(row.id)}
        emptyMessage={t("empty")}
        testId="payouts-table"
        exportConfig={{
          fileName: "payroll",
          sheetName: t("title"),
          columns: exportColumns,
        }}
        refreshToken={refreshToken}
      />

      <PayoutDetailModal
        payoutId={selectedId}
        onClose={() => setSelectedId(null)}
        onMutated={refreshAll}
      />

      {isOwner && (
        <FinalizePeriodModal
          open={finalizeOpen}
          defaultYear={periodYear ? Number(periodYear) : undefined}
          defaultMonth={periodMonth ? Number(periodMonth) : undefined}
          onClose={() => setFinalizeOpen(false)}
          onSuccess={(finalized, period) => {
            setFinalizeOpen(false);
            setFlash(t("finalizeSuccess", { count: finalized, period }));
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

/** Two-letter initials for the teacher avatar chip. */
function initials(name?: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || "—";
}
