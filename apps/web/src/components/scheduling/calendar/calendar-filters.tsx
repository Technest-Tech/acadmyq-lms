"use client";

import type { SessionStatus } from "@academiq/contracts";
import { Check, ChevronDown, ListFilter, Search, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { STATUS_DOT, STATUS_ORDER } from "./utils";

type T = ReturnType<typeof useTranslations>;

/**
 * Calendar search + status filter (client-side over the fetched feed). Search matches
 * student/teacher name; the status dropdown narrows by outcome.
 *
 * The dropdown is multi-select on purpose — the two cancellation statuses are separate rows, and
 * an owner reviewing cancellations wants both at once. An empty selection means "show
 * everything", which is what the All row resets to, so All is the lit row until a specific
 * status is picked.
 */
export function CalendarFilters({
  t,
  query,
  onQuery,
  statuses,
  onToggleStatus,
  onClear,
  shown,
  total,
}: {
  t: T;
  query: string;
  onQuery: (q: string) => void;
  statuses: Set<SessionStatus>;
  onToggleStatus: (s: SessionStatus) => void;
  onClear: () => void;
  /** Sessions surviving the filters, and the total fetched — so the numbers on screen are explained. */
  shown: number;
  total: number;
}) {
  const filtered = statuses.size > 0;
  const narrowed = shown !== total;

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — the panel is a plain popover, not a modal.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The trigger says what's actually on: All, the one status, or how many.
  const only = statuses.size === 1 ? [...statuses][0]! : null;
  const triggerLabel = !filtered
    ? t("calendar.filterAll")
    : only
      ? t(`status.${only}`)
      : t("calendar.statusesSelected", { count: statuses.size });

  return (
    <div className="bg-card flex flex-col gap-2.5 rounded-2xl border p-3 shadow-sm sm:flex-row sm:items-center">
      {/* Search */}
      <div className="relative w-full shrink-0 sm:w-64">
        <Search
          className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          type="search"
          data-testid="calendar-search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("calendar.searchPlaceholder")}
          aria-label={t("calendar.searchPlaceholder")}
          className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border py-2 pe-8 ps-9 text-sm outline-none transition-colors focus:ring-3"
        />
        {query && (
          <button
            type="button"
            aria-label={t("calendar.clearSearch")}
            onClick={() => onQuery("")}
            className="text-muted-foreground hover:text-foreground absolute end-2.5 top-1/2 -translate-y-1/2"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Status dropdown */}
      <div ref={wrapRef} className="relative w-full shrink-0 sm:w-56">
        <button
          type="button"
          data-testid="status-filter-trigger"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "border-input bg-background hover:bg-muted/40 focus-visible:border-primary focus-visible:ring-primary/20 flex h-10 w-full items-center gap-2 rounded-xl border px-3.5 text-start text-sm outline-none transition-all focus-visible:ring-2",
            open && "border-primary ring-primary/20 ring-2",
          )}
        >
          {only ? (
            <span
              className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[only])}
              aria-hidden
            />
          ) : (
            <ListFilter
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
          )}
          <span
            className={cn(
              "flex-1 truncate",
              !filtered && "text-muted-foreground",
            )}
          >
            {triggerLabel}
          </span>
          {filtered && (
            <span className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums">
              {statuses.size}
            </span>
          )}
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {open && (
          <ul
            role="listbox"
            aria-multiselectable
            aria-label={t("calendar.statusLabel")}
            className="border-border bg-popover absolute z-50 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border py-1 shadow-xl"
          >
            {/* All — clears the selection rather than being a status of its own. */}
            <li
              role="option"
              aria-selected={!filtered}
              data-testid="status-filter-all"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className={cn(
                "hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                !filtered && "text-primary bg-primary/8 font-semibold",
              )}
            >
              <ListFilter className="size-3.5 shrink-0" aria-hidden />
              <span className="flex-1 truncate">{t("calendar.filterAll")}</span>
              {!filtered && <Check className="size-3.5 shrink-0" aria-hidden />}
            </li>

            <li className="bg-border my-1 h-px" role="presentation" />

            {STATUS_ORDER.map((s) => {
              const active = statuses.has(s);
              return (
                <li
                  key={s}
                  role="option"
                  aria-selected={active}
                  data-testid={`status-filter-${s}`}
                  // Stays open on pick: choosing several statuses is one gesture, not N.
                  onClick={() => onToggleStatus(s)}
                  className={cn(
                    "hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                    active && "font-semibold",
                  )}
                >
                  <span
                    className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[s])}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{t(`status.${s}`)}</span>
                  {active && (
                    <Check
                      className="text-primary size-3.5 shrink-0"
                      aria-hidden
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Result count — only once the feed is actually narrowed, so it isn't noise. */}
      {narrowed && (
        <span
          data-testid="filter-count"
          className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums sm:ms-auto"
        >
          {t("calendar.showingCount", { shown, total })}
        </span>
      )}
    </div>
  );
}
