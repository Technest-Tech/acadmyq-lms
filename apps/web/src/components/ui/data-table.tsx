"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, type DataTableQuery, type ListResult } from "@/lib/api";
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
  testId?: string;
  /** Change this to force a refetch after a mutation elsewhere. */
  refreshToken?: number;
}

const inputClass =
  "border-input bg-background rounded-md border px-3 py-2 text-sm";

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
  const sortArrow = (sortKey: string) =>
    sort === sortKey ? " ↑" : sort === `-${sortKey}` ? " ↓" : "";

  return (
    <div className="space-y-3" data-testid={testId}>
      {/* Toolbar: search + filters on the start side, actions on the end. */}
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <input
            type="search"
            aria-label={t("search")}
            placeholder={t("search")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={cn(inputClass, "min-w-48 flex-1")}
            data-testid="dt-search"
          />
        )}
        {filters.map((f) => (
          <select
            key={f.key}
            aria-label={f.label}
            value={filterValues[f.key] ?? ""}
            onChange={(e) => setFilter(f.key, e.target.value)}
            className={inputClass}
            data-testid={`dt-filter-${f.key}`}
          >
            <option value="">{f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {toolbar && <div className="ms-auto">{toolbar}</div>}
      </div>

      {error ? (
        <div
          className="rounded-md border p-6 text-center"
          role="alert"
          data-testid="dt-error"
        >
          <p className="text-destructive text-sm">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void load()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : loading && data === null ? (
        <div
          className="space-y-2 rounded-md border p-3"
          data-testid="dt-loading"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted/60 h-8 animate-pulse rounded"
              aria-hidden
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-md border p-8 text-center"
          data-testid="dt-empty"
        >
          <p className="text-muted-foreground text-sm">
            {emptyMessage ?? t("empty")}
          </p>
          {emptyAction && <div className="mt-3">{emptyAction}</div>}
        </div>
      ) : (
        <>
          {/* Table for >= sm; stacked cards below. */}
          <div
            className="hidden overflow-x-auto rounded-md border sm:block"
            data-testid="dt-table-wrap"
          >
            <table className="w-full text-sm" data-testid="dt-table">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={cn("px-3 py-2 text-start", c.className)}
                    >
                      {c.sortKey ? (
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => toggleSort(c.sortKey!)}
                          data-testid={`dt-sort-${c.key}`}
                        >
                          {c.header}
                          {sortArrow(c.sortKey)}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  ))}
                  {rowActions && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr
                    key={getRowId(row)}
                    data-row={getRowId(row)}
                    className={cn(onRowClick && "hover:bg-muted/40")}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn("px-3 py-2", c.className)}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="px-3 py-2 text-end">{rowActions(row)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 sm:hidden" data-testid="dt-cards">
            {rows.map((row) => (
              <li
                key={getRowId(row)}
                data-card={getRowId(row)}
                className="space-y-1 rounded-md border p-3 text-sm"
              >
                {columns.map((c) => (
                  <div key={c.key} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{c.header}</span>
                    <span className="text-end">{c.render(row)}</span>
                  </div>
                ))}
                {rowActions && (
                  <div className="flex justify-end pt-1">{rowActions(row)}</div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Pagination footer (hidden when empty/error/initial-loading). */}
      {data !== null && rows.length > 0 && (
        <div
          className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs"
          data-testid="dt-pagination"
        >
          <span data-testid="dt-total">
            {t("total", { count: fmt.format(total) })}
          </span>
          <div className="flex items-center gap-2">
            <select
              aria-label={t("pageSize")}
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
              className={cn(inputClass, "py-1")}
              data-testid="dt-page-size"
            >
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {fmt.format(n)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="dt-prev"
            >
              {t("prev")}
            </Button>
            <span data-testid="dt-page">
              {fmt.format(page)} / {fmt.format(totalPages)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              data-testid="dt-next"
            >
              {t("next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
