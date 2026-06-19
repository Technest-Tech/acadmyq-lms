"use client";

import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  FileSpreadsheet,
  Inbox,
  Loader2,
  Search,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, type DataTableQuery, type ListResult } from "@/lib/api";
import {
  type ExcelColumn,
  exportRowsToExcel,
  fetchAllRows,
} from "@/lib/export-excel";
import { cn } from "@/lib/utils";

/**
 * The one reusable, server-driven data table (Sprint 4 §6). Every list screen from here on
 * uses it. Search, filters, multi-column-capable sort and pagination all run on the SERVER
 * (within RLS scope) — the browser only renders a page. States: loading skeletons, an
 * actionable empty state, and a retryable error. Bilingual + RTL via CSS logical properties
 * and the <html dir> set in the root layout; collapses to stacked cards under ~640px.
 *
 * Security note: the column the server sorts/filters by is chosen by `sortKey`/filter `key`
 * here — an allowlist the server validates again (a crafted key is a 422). The client never
 * sends a raw SQL column.
 */
export interface ColumnDef<T> {
  /** Stable column id (also the i18n/test handle). */
  key: string;
  header: string;
  /** When set, the header is clickable and sends this server sort key. */
  sortKey?: string;
  render: (row: T) => React.ReactNode;
  /** Header + cell extra classes (e.g. text-end for numeric columns). */
  className?: string;
}

export interface FilterDef {
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export interface DataTableProps<T> {
  fetcher: (q: DataTableQuery) => Promise<ListResult<T>>;
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string;
  searchable?: boolean;
  filters?: FilterDef[];
  defaultSort?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  /** Right-aligned toolbar content, e.g. a "New" button. */
  toolbar?: React.ReactNode;
  /**
   * When set, renders an "Export Excel" button that downloads every row matching the
   * current search/filter/sort (not just the visible page) as an .xlsx file. The
   * export columns are declared explicitly so they can differ from the on-screen
   * columns (e.g. raw values instead of badges).
   */
  exportConfig?: {
    fileName: string;
    sheetName?: string;
    columns: ExcelColumn<T>[];
  };
  testId?: string;
  /** Change this to force a refetch after a mutation elsewhere. */
  refreshToken?: number;
}

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 h-8 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

export function DataTable<T>({
  fetcher,
  columns,
  getRowId,
  searchable = false,
  filters = [],
  defaultSort,
  pageSize = 25,
  onRowClick,
  rowActions,
  emptyMessage,
  emptyAction,
  toolbar,
  exportConfig,
  testId = "data-table",
  refreshToken = 0,
}: DataTableProps<T>) {
  const t = useTranslations("datatable");
  const locale = useLocale();
  const fmt = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<string>(defaultSort ?? "");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  const [data, setData] = useState<ListResult<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Debounce the free-text search so we query on a pause, not every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const filterKey = JSON.stringify(filterValues);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher({
        search: search || undefined,
        sort: sort || undefined,
        page,
        pageSize: size,
        filter: filterValues,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // filterKey stands in for filterValues; eslint-safe and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, search, sort, page, size, filterKey, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Export every row matching the CURRENT query (search/sort/filter) — fetchAllRows
  // walks the server pages, so this is the full result set, not just the visible page.
  async function handleExport() {
    if (!exportConfig || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const { rows: allRows } = await fetchAllRows(fetcher, {
        search: search || undefined,
        sort: sort || undefined,
        filter: filterValues,
      });
      await exportRowsToExcel({
        fileName: exportConfig.fileName,
        sheetName: exportConfig.sheetName,
        columns: exportConfig.columns,
        rows: allRows,
        rightToLeft: locale === "ar",
      });
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : t("exportError"));
    } finally {
      setExporting(false);
    }
  }

  function toggleSort(sortKey: string) {
    setPage(1);
    setSort((prev) => (prev === sortKey ? `-${sortKey}` : sortKey));
  }

  function setFilter(key: string, value: string) {
    setPage(1);
    setFilterValues((prev) => {
      const next = { ...prev };
      if (value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));

  function SortIndicator({ sortKey }: { sortKey: string }) {
    if (sort === sortKey)
      return <ChevronUp className="ms-1 inline size-3 shrink-0" />;
    if (sort === `-${sortKey}`)
      return <ChevronDown className="ms-1 inline size-3 shrink-0" />;
    return (
      <ChevronsUpDown className="ms-1 inline size-3 shrink-0 opacity-35" />
    );
  }

  return (
    <div className="space-y-3" data-testid={testId}>
      {/* Toolbar: search + filters on the start side, actions on the end. */}
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative min-w-48 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
            <input
              type="search"
              aria-label={t("search")}
              placeholder={t("search")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={cn(inputClass, "ps-9")}
              data-testid="dt-search"
            />
          </div>
        )}
        {filters.map((f) => {
          const isActive = !!filterValues[f.key];
          return (
            <div key={f.key} className="relative">
              <select
                aria-label={f.label}
                value={filterValues[f.key] ?? ""}
                onChange={(e) => setFilter(f.key, e.target.value)}
                className={cn(
                  "h-8 cursor-pointer appearance-none rounded-lg border pe-8 ps-3 text-sm font-medium shadow-sm outline-none transition-all",
                  "focus:ring-2 focus:ring-primary/20 focus:outline-none",
                  isActive
                    ? "border-primary/40 bg-primary/8 text-primary hover:bg-primary/12"
                    : "border-input bg-background text-foreground hover:bg-muted/50 focus:border-primary",
                )}
                data-testid={`dt-filter-${f.key}`}
              >
                <option value="">{f.label}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className={cn(
                  "pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden
              />
            </div>
          );
        })}
        {(exportConfig || toolbar) && (
          <div className="ms-auto flex items-center gap-2">
            {exportConfig && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleExport()}
                disabled={exporting || (data?.total ?? 0) === 0}
                className="gap-1.5"
                data-testid="dt-export"
              >
                {exporting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <FileSpreadsheet className="size-3.5" aria-hidden />
                )}
                {t("export")}
              </Button>
            )}
            {toolbar}
          </div>
        )}
      </div>

      {exportError && (
        <p
          className="text-destructive text-xs font-medium"
          role="alert"
          data-testid="dt-export-error"
        >
          {exportError}
        </p>
      )}

      {error ? (
        <div
          className="border-destructive/20 bg-destructive/5 flex flex-col items-center rounded-xl border p-10 text-center"
          role="alert"
          data-testid="dt-error"
        >
          <AlertCircle className="text-destructive/60 mb-3 size-8" />
          <p className="text-destructive text-sm font-medium">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void load()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : loading && data === null ? (
        <div
          className="overflow-hidden rounded-xl border"
          data-testid="dt-loading"
        >
          <div className="bg-muted/30 border-b px-4 py-3">
            <div
              className="bg-muted-foreground/15 h-3 w-36 rounded"
              aria-hidden
            />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-4 border-b px-4 py-3.5 last:border-0"
            >
              {Array.from({ length: Math.min(columns.length, 4) }).map(
                (_, j) => (
                  <div
                    key={j}
                    className="bg-muted h-4 flex-1 animate-pulse rounded"
                    aria-hidden
                  />
                ),
              )}
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="border-border/60 bg-muted/20 flex flex-col items-center rounded-xl border border-dashed p-12 text-center"
          data-testid="dt-empty"
        >
          <div className="bg-muted mb-3 flex size-12 items-center justify-center rounded-full">
            <Inbox className="text-muted-foreground size-5" />
          </div>
          <p className="text-sm font-medium">
            {emptyMessage ?? t("empty")}
          </p>
          {emptyAction && <div className="mt-4">{emptyAction}</div>}
        </div>
      ) : (
        <>
          {/* Table for >= sm */}
          <div
            className="hidden overflow-hidden rounded-xl border sm:block"
            data-testid="dt-table-wrap"
          >
            <table className="w-full text-sm" data-testid="dt-table">
              <thead>
                <tr className="bg-muted/30 border-b">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "text-muted-foreground px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide",
                        c.className,
                      )}
                    >
                      {c.sortKey ? (
                        <button
                          type="button"
                          className="inline-flex items-center hover:text-foreground transition-colors"
                          onClick={() => toggleSort(c.sortKey!)}
                          data-testid={`dt-sort-${c.key}`}
                        >
                          {c.header}
                          <SortIndicator sortKey={c.sortKey} />
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  ))}
                  {rowActions && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr
                    key={getRowId(row)}
                    data-row={getRowId(row)}
                    className={cn(
                      "transition-colors",
                      onRowClick && "hover:bg-muted/30 cursor-pointer",
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn("px-4 py-3", c.className)}
                        onClick={
                          onRowClick ? () => onRowClick(row) : undefined
                        }
                      >
                        {c.render(row)}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="px-4 py-3 text-end">
                        {rowActions(row)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked cards for mobile */}
          <ul className="space-y-2 sm:hidden" data-testid="dt-cards">
            {rows.map((row) => (
              <li
                key={getRowId(row)}
                data-card={getRowId(row)}
                className="bg-card rounded-xl border p-4 text-sm shadow-sm"
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <div key={c.key} className="flex justify-between gap-3 py-1">
                    <span className="text-muted-foreground text-xs">
                      {c.header}
                    </span>
                    <span className="text-end text-xs font-medium">
                      {c.render(row)}
                    </span>
                  </div>
                ))}
                {rowActions && (
                  <div className="mt-2 flex justify-end border-t pt-2">
                    {rowActions(row)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Pagination footer */}
      {data !== null && rows.length > 0 && (
        <div
          className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs"
          data-testid="dt-pagination"
        >
          <span data-testid="dt-total">
            {t("total", { count: fmt.format(total) })}
          </span>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <select
                aria-label={t("pageSize")}
                value={size}
                onChange={(e) => {
                  setSize(Number(e.target.value));
                  setPage(1);
                }}
                className="border-input bg-background focus:border-primary h-6 cursor-pointer appearance-none rounded-md border pe-6 ps-2 text-xs outline-none transition-colors"
                data-testid="dt-page-size"
              >
                {[10, 25, 50].map((n) => (
                  <option key={n} value={n}>
                    {fmt.format(n)}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-muted-foreground pointer-events-none absolute end-1.5 top-1/2 size-3 -translate-y-1/2" aria-hidden />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="dt-prev"
              aria-label={t("prev")}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="px-1 font-medium" data-testid="dt-page">
              {fmt.format(page)} / {fmt.format(totalPages)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              data-testid="dt-next"
              aria-label={t("next")}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
