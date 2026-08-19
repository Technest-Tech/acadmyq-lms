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
  ListFilter,
  Loader2,
  Rows2,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Octagram } from "@/components/ornaments";
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
 * The chrome is the panel's own: a control rail (search → filters → density → export → action),
 * a row of removable chips naming exactly what is currently narrowing the list, and a header that
 * stays put while the body scrolls under it, closed by the gold hairline the rest of the frame
 * uses. That last part is why the BODY is the scroll container rather than the page: a sticky
 * `thead` only sticks inside the nearest scrollport, so the panel has to own one.
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
  /** Header-only extra classes — column sizing (`w-*`, `min-w-*`) belongs here. */
  headerClassName?: string;
  /** Hide on the mobile card list — for columns already folded into the card title. */
  hideOnCard?: boolean;
}

export interface FilterDef {
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /**
   * Declared but not shown as a select. For filters only a preset can set (a stat tile's
   * `trial_any`, say) — registering it here is what lets the chip row name it in words and
   * offer a ✕, instead of the list silently narrowing with nothing to explain why.
   */
  hidden?: boolean;
}

export interface DataTableProps<T> {
  fetcher: (q: DataTableQuery) => Promise<ListResult<T>>;
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string;
  searchable?: boolean;
  /** Overrides the generic "Search" placeholder, e.g. "Search name, parent or phone…". */
  searchPlaceholder?: string;
  filters?: FilterDef[];
  defaultSort?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  /**
   * Called when the pointer first enters a row. Screens that navigate on click use it to warm the
   * destination (`router.prefetch`) before the click happens — the difference between a route that
   * opens instantly and one that appears to hang.
   */
  onRowHover?: (row: T) => void;
  /**
   * The row whose click is still in flight. It gets a spinner and a highlight, and the table stops
   * accepting further clicks: a navigation that takes a second must SAY it is happening, or the
   * user clicks three more rows believing nothing registered.
   */
  pendingRowId?: string | null;
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
  /**
   * Drive the filters from OUTSIDE the table — the pattern the stat tiles above a list use, where
   * clicking "Trials" narrows the table below. `token` is the trigger: bump it and `values`
   * REPLACES the current filter set (an empty object clears it). Kept as a token rather than a
   * plain value so a user's own edits to the selects are never fought by a re-render.
   */
  filterPreset?: { values: Record<string, string>; token: number };
  /** Number the rows — the running index within the current page, ERP-style. */
  showIndex?: boolean;
  /**
   * Max height of the scrolling body, as a CSS length. The body owns the scroll so the header can
   * stay pinned; pass `undefined` to let the table grow and scroll with the page instead.
   */
  maxBodyHeight?: string;
}

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 h-9 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

export function DataTable<T>({
  fetcher,
  columns,
  getRowId,
  searchable = false,
  searchPlaceholder,
  filters = [],
  defaultSort,
  pageSize = 25,
  onRowClick,
  onRowHover,
  pendingRowId = null,
  rowActions,
  emptyMessage,
  emptyAction,
  toolbar,
  exportConfig,
  testId = "data-table",
  refreshToken = 0,
  filterPreset,
  showIndex = false,
  maxBodyHeight = "min(68vh, 44rem)",
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
  const [compact, setCompact] = useState(false);

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

  // An outside preset (a stat tile, a segment) REPLACES the filter set. Only a change of `token`
  // applies it, so re-renders never overwrite a filter the user picked from the selects.
  const presetToken = filterPreset?.token;
  const seenToken = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (presetToken === undefined || presetToken === seenToken.current) return;
    seenToken.current = presetToken;
    setFilterValues({ ...(filterPreset?.values ?? {}) });
    setPage(1);
    // `filterPreset.values` is read at token time on purpose — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetToken]);

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

  function clearAll() {
    setPage(1);
    setFilterValues({});
    setSearchInput("");
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  /** What is currently narrowing the list, resolved to human labels for the chip row. */
  const activeChips = useMemo(
    () =>
      Object.entries(filterValues).flatMap(([key, value]) => {
        const def = filters.find((f) => f.key === key);
        if (!def) return [];
        const opt = def.options.find((o) => o.value === value);
        return [{ key, label: def.label, value: opt?.label ?? value }];
      }),
    [filterValues, filters],
  );
  const narrowed = activeChips.length + (search ? 1 : 0);

  /** The columns the mobile card repeats as label/value — the first one becomes its title. */
  const cardColumns = columns.filter((c, i) => i > 0 && !c.hideOnCard);

  const cellPad = compact ? "px-3 py-2" : "px-4 py-3";

  function SortIndicator({ sortKey }: { sortKey: string }) {
    if (sort === sortKey)
      return <ChevronUp className="ms-1 inline size-3 shrink-0 text-primary" />;
    if (sort === `-${sortKey}`)
      return <ChevronDown className="ms-1 inline size-3 shrink-0 text-primary" />;
    return (
      <ChevronsUpDown className="ms-1 inline size-3 shrink-0 opacity-30" />
    );
  }

  return (
    <div className="space-y-3" data-testid={testId}>
      {/* ── Control rail ─────────────────────────────────────────────────────
          One surface holding everything that changes what the table shows, so the eye has a
          single place to look rather than controls scattered along the panel's top edge. */}
      <div className="bg-muted/35 rounded-xl border p-2">
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative min-w-52 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
              <input
                type="search"
                aria-label={t("search")}
                placeholder={searchPlaceholder ?? t("search")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={cn(inputClass, "w-full bg-card ps-9 pe-9")}
                data-testid="dt-search"
              />
              {searchInput && (
                <button
                  type="button"
                  aria-label={t("clearSearch")}
                  onClick={() => setSearchInput("")}
                  className="text-muted-foreground hover:text-foreground absolute end-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 transition-colors"
                  data-testid="dt-search-clear"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}

          {filters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <ListFilter
                className="text-muted-foreground/70 size-3.5 shrink-0"
                aria-hidden
              />
              {filters.filter((f) => !f.hidden).map((f) => {
                const isActive = !!filterValues[f.key];
                return (
                  <div key={f.key} className="relative">
                    <select
                      aria-label={f.label}
                      value={filterValues[f.key] ?? ""}
                      onChange={(e) => setFilter(f.key, e.target.value)}
                      className={cn(
                        "h-9 cursor-pointer appearance-none rounded-lg border pe-8 ps-3 text-sm font-medium shadow-sm outline-none transition-all",
                        "focus:ring-2 focus:ring-primary/20 focus:outline-none",
                        isActive
                          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                          : "border-input bg-card text-foreground hover:bg-muted/60 focus:border-primary",
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
            </div>
          )}

          <div className="ms-auto flex items-center gap-2">
            {/* Density — the difference between reading ten rows and scanning fifty. */}
            <button
              type="button"
              onClick={() => setCompact((c) => !c)}
              title={compact ? t("comfortable") : t("compact")}
              aria-label={t("density")}
              aria-pressed={compact}
              className="border-input bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 flex size-9 items-center justify-center rounded-lg border shadow-sm transition-colors"
              data-testid="dt-density"
            >
              {compact ? (
                <Rows3 className="size-4" aria-hidden />
              ) : (
                <Rows2 className="size-4" aria-hidden />
              )}
            </button>
            {exportConfig && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => void handleExport()}
                disabled={exporting || (data?.total ?? 0) === 0}
                className="gap-1.5 bg-card shadow-sm"
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
        </div>

        {/* Applied filters, named and removable — the answer to "why am I only seeing 3 rows?" */}
        {narrowed > 0 && (
          <div
            className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2"
            data-testid="dt-active-filters"
          >
            <SlidersHorizontal
              className="text-muted-foreground/70 size-3 shrink-0"
              aria-hidden
            />
            {search && (
              <span className="bg-card inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-sm">
                <Search className="size-2.5 opacity-60" aria-hidden />
                <span className="max-w-40 truncate">{search}</span>
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t("clearSearch")}
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
            {activeChips.map((chip) => (
              <span
                key={chip.key}
                className="border-primary/25 bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                data-testid={`dt-chip-${chip.key}`}
              >
                <span className="opacity-70">{chip.label}:</span>
                <span className="font-semibold">{chip.value}</span>
                <button
                  type="button"
                  onClick={() => setFilter(chip.key, "")}
                  className="opacity-60 transition-opacity hover:opacity-100"
                  aria-label={`${chip.label}: ${chip.value}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={clearAll}
              className="text-muted-foreground hover:text-foreground ms-1 text-[11px] font-semibold underline underline-offset-2"
              data-testid="dt-clear-filters"
            >
              {t("clearAll")}
            </button>
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
          <div className="bg-muted/40 border-b px-4 py-3">
            <div
              className="bg-muted-foreground/15 h-3 w-36 rounded"
              aria-hidden
            />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0"
            >
              <div className="bg-muted size-8 shrink-0 animate-pulse rounded-xl" aria-hidden />
              {Array.from({ length: Math.min(columns.length, 4) }).map(
                (_, j) => (
                  <div
                    key={j}
                    className="bg-muted h-3.5 flex-1 animate-pulse rounded"
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
          {narrowed > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-primary mt-2 text-xs font-semibold underline underline-offset-2"
            >
              {t("clearAll")}
            </button>
          )}
          {emptyAction && <div className="mt-4">{emptyAction}</div>}
        </div>
      ) : (
        <>
          {/* Table for >= sm. The BODY scrolls (not the page) so the header stays readable at
              row 40 — and so a wide row can scroll sideways without dragging the panel with it. */}
          <div
            className="relative hidden rounded-xl border sm:block"
            data-testid="dt-table-wrap"
          >
            {/* A refetch keeps the current rows on screen and dims them: the layout never
                collapses and reflows under the cursor mid-click. */}
            {loading && (
              <div
                className="bg-card/55 pointer-events-none absolute inset-0 z-20 flex items-start justify-center rounded-xl backdrop-blur-[1px]"
                aria-hidden
              >
                <span className="bg-card text-muted-foreground mt-16 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("refreshing")}
                </span>
              </div>
            )}
            <div
              className="scroll-ornate overflow-auto rounded-xl"
              style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
            >
              <table className="w-full text-sm" data-testid="dt-table">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-card/95 backdrop-blur">
                    {showIndex && (
                      <th className="text-muted-foreground/60 w-10 px-3 py-3 text-start text-[10px] font-bold">
                        #
                      </th>
                    )}
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className={cn(
                          "text-muted-foreground px-4 py-3 text-start text-[11px] font-bold uppercase tracking-wider whitespace-nowrap",
                          c.className,
                          c.headerClassName,
                        )}
                      >
                        {c.sortKey ? (
                          <button
                            type="button"
                            className="hover:text-foreground inline-flex items-center transition-colors"
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
                  {/* The gold hairline that closes every other frame in the app closes the
                      header too — and hides the seam as rows scroll beneath it. */}
                  <tr aria-hidden>
                    <th
                      colSpan={columns.length + (showIndex ? 1 : 0) + (rowActions ? 1 : 0)}
                      className="via-gold/50 h-px bg-gradient-to-r from-transparent to-transparent p-0"
                    />
                  </tr>
                </thead>
                <tbody className="divide-border/70 divide-y">
                  {rows.map((row, i) => {
                    const rowId = getRowId(row);
                    const pending = pendingRowId === rowId;
                    const openRow = onRowClick ? () => onRowClick(row) : undefined;
                    return (
                    <tr
                      key={rowId}
                      data-row={rowId}
                      onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
                      aria-busy={pending || undefined}
                      className={cn(
                        "group relative transition-colors",
                        onRowClick && "hover:bg-primary/[0.045] cursor-pointer",
                        pending && "bg-primary/[0.07]",
                      )}
                    >
                      {showIndex && (
                        <td
                          className={cn(
                            "text-muted-foreground/50 relative text-[11px] font-semibold tabular-nums",
                            compact ? "px-3 py-2" : "px-3 py-3",
                          )}
                          onClick={openRow}
                        >
                          {/* The emerald marker on the leading edge — which row the cursor is on,
                              readable without relying on a wash of background colour alone. It
                              stays lit while that row's click is in flight. */}
                          <span
                            className={cn(
                              "from-primary to-primary/40 absolute inset-y-1 start-0 w-[3px] rounded-full bg-gradient-to-b transition-opacity",
                              pending ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            )}
                          />
                          {pending ? (
                            <Loader2 className="text-primary size-3.5 animate-spin" aria-hidden />
                          ) : (
                            fmt.format(from + i)
                          )}
                        </td>
                      )}
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={cn(cellPad, "align-middle", c.className)}
                          onClick={openRow}
                        >
                          {c.render(row)}
                        </td>
                      ))}
                      {rowActions && (
                        <td className={cn(cellPad, "text-end whitespace-nowrap")}>
                          {rowActions(row)}
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stacked cards for mobile: the first column is the card's identity, the rest are
              label/value lines — a phone-width table would otherwise be unreadable. */}
          <ul className="space-y-2 sm:hidden" data-testid="dt-cards">
            {rows.map((row) => (
              <li
                key={getRowId(row)}
                data-card={getRowId(row)}
                aria-busy={pendingRowId === getRowId(row) || undefined}
                className={cn(
                  "bg-card overflow-hidden rounded-xl border text-sm shadow-sm",
                  pendingRowId === getRowId(row) && "ring-primary/30 ring-2",
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                <div className="from-primary/[0.07] flex items-center gap-2 border-b bg-gradient-to-r to-transparent px-4 py-3">
                  <div className="min-w-0 flex-1">{columns[0]?.render(row)}</div>
                  {pendingRowId === getRowId(row) && (
                    <Loader2 className="text-primary size-4 shrink-0 animate-spin" aria-hidden />
                  )}
                </div>
                <div className="divide-border/60 divide-y px-4">
                  {cardColumns.map((c) => (
                    <div
                      key={c.key}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="text-muted-foreground shrink-0 text-[11px] font-medium uppercase tracking-wide">
                        {c.header}
                      </span>
                      <span className="min-w-0 text-end text-xs font-medium">
                        {c.render(row)}
                      </span>
                    </div>
                  ))}
                </div>
                {rowActions && (
                  <div className="bg-muted/25 flex justify-end border-t px-4 py-2.5">
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
          className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs"
          data-testid="dt-pagination"
        >
          <span className="inline-flex items-center gap-2" data-testid="dt-total">
            <Octagram className="text-gold/60 size-2 shrink-0" />
            <span>
              {t("showing", {
                from: fmt.format(from),
                to: fmt.format(to),
                total: fmt.format(total),
              })}
            </span>
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
                className="border-input bg-card focus:border-primary h-7 cursor-pointer appearance-none rounded-md border pe-6 ps-2 text-xs outline-none transition-colors"
                data-testid="dt-page-size"
              >
                {[10, 25, 50, 100].map((n) => (
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
              <ChevronLeft className="size-3.5 rtl:-scale-x-100" />
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
              <ChevronRight className="size-3.5 rtl:-scale-x-100" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
