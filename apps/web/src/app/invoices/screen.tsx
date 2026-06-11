"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { InvoiceDetailModal } from "@/components/invoices/invoice-detail-modal";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef, type FilterDef } from "@/components/ui/data-table";
import { apiFetch, toQueryString, type DataTableQuery, type ListResult } from "@/lib/api";
import { formatMoney } from "@/lib/money";

// ── Invoice list row shape (mirrors the API response) ──────────────────────────

export interface InvoiceRow {
  id: string;
  payer_name: string;
  payer_type: "GUARDIAN" | "STUDENT";
  period_month: number;
  period_year: number;
  status: "OPEN" | "CLOSED" | "PAID" | "PARTIALLY_PAID";
  total_minor: number;
  currency: string;
  created_at: string;
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  InvoiceRow["status"],
  string
> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  CLOSED: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  PARTIALLY_PAID: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
};

function InvoiceStatusBadge({ status }: { status: InvoiceRow["status"] }) {
  const t = useTranslations("invoices");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

// ── Period filter helpers ──────────────────────────────────────────────────────

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

// ── Screen ─────────────────────────────────────────────────────────────────────

/**
 * Client gate + DataTable for the invoices list (Sprint 7).
 * Permission-gated by invoice.read; row click opens InvoiceDetailModal.
 */
export function InvoicesScreen() {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const { can } = useAuth();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Extra free-form period filters (year + month dropdowns outside DataTable filters
  // since DataTable only supports option-list filters; we pass them via the fetcher).
  const [periodYear, setPeriodYear] = useState<string>("");
  const [periodMonth, setPeriodMonth] = useState<string>("");

  // Stable fetcher that merges period filters into the query.
  const fetcher = useCallback(
    (q: DataTableQuery): Promise<ListResult<InvoiceRow>> => {
      const merged: DataTableQuery = {
        ...q,
        filter: {
          ...(q.filter ?? {}),
          ...(periodYear ? { period_year: periodYear } : {}),
          ...(periodMonth ? { period_month: periodMonth } : {}),
        },
      };
      return apiFetch(`/api/invoices${toQueryString(merged)}`);
    },
    [periodYear, periodMonth],
  );

  if (!can("invoice.read")) {
    return (
      <p className="text-muted-foreground text-sm">{t("noPermission")}</p>
    );
  }

  const columns: ColumnDef<InvoiceRow>[] = [
    {
      key: "period",
      header: t("colPeriod"),
      sortKey: "period",
      render: (row) => (
        <span className="tabular-nums">
          {String(row.period_month).padStart(2, "0")}/{row.period_year}
        </span>
      ),
    },
    {
      key: "payer",
      header: t("colPayer"),
      sortKey: "payer_name",
      render: (row) => <span className="font-medium">{row.payer_name}</span>,
    },
    {
      key: "status",
      header: t("colStatus"),
      render: (row) => <InvoiceStatusBadge status={row.status} />,
    },
    {
      key: "total",
      header: t("colTotal"),
      sortKey: "total_minor",
      className: "text-end",
      render: (row) =>
        formatMoney({ amount: row.total_minor, currency: row.currency }, locale),
    },
    {
      key: "actions",
      header: "",
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
      className: "text-end",
    },
  ];

  const statusFilter: FilterDef = {
    key: "status",
    label: t("filterStatus"),
    options: [
      { value: "OPEN", label: t("status.OPEN") },
      { value: "CLOSED", label: t("status.CLOSED") },
      { value: "PAID", label: t("status.PAID") },
      { value: "PARTIALLY_PAID", label: t("status.PARTIALLY_PAID") },
    ],
  };

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 h-8 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
      </div>

      {/* Period selectors (outside DataTable's built-in filters) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <select
            aria-label={t("filterYear")}
            value={periodYear}
            onChange={(e) => {
              setPeriodYear(e.target.value);
              setRefreshToken((n) => n + 1);
            }}
            className={inputClass}
          >
            <option value="">{t("filterYear")}</option>
            {YEARS.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="relative">
          <select
            aria-label={t("filterMonth")}
            value={periodMonth}
            onChange={(e) => {
              setPeriodMonth(e.target.value);
              setRefreshToken((n) => n + 1);
            }}
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
      </div>

      <DataTable<InvoiceRow>
        fetcher={fetcher}
        columns={columns}
        getRowId={(row) => row.id}
        filters={[statusFilter]}
        defaultSort="-period"
        onRowClick={(row) => setSelectedId(row.id)}
        emptyMessage={t("empty")}
        testId="invoices-table"
        refreshToken={refreshToken}
      />

      <InvoiceDetailModal
        invoiceId={selectedId}
        onClose={() => {
          setSelectedId(null);
          setRefreshToken((n) => n + 1);
        }}
      />
    </div>
  );
}
