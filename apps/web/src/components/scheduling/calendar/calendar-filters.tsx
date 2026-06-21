"use client";

import type { SessionStatus } from "@academiq/contracts";
import { Search, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { STATUS_DOT, STATUS_ORDER } from "./utils";

type T = ReturnType<typeof useTranslations>;

/**
 * Calendar search + status filter row (client-side over the fetched feed). Search matches
 * student/teacher name; the status chips narrow by outcome. An empty `statuses` set means
 * "show everything" — so the All chip is the lit one until a specific status is picked.
 */
export function CalendarFilters({
  t,
  query,
  onQuery,
  statuses,
  onToggleStatus,
  onClear,
}: {
  t: T;
  query: string;
  onQuery: (q: string) => void;
  statuses: Set<SessionStatus>;
  onToggleStatus: (s: SessionStatus) => void;
  onClear: () => void;
}) {
  const filtered = statuses.size > 0;

  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
      {/* Search */}
      <div className="relative w-full sm:w-64">
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
          className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border py-2 ps-9 pe-3 text-sm outline-none transition-colors focus:ring-3"
        />
        {query && (
          <button
            type="button"
            aria-label={t("calendar.clearSearch")}
            onClick={() => onQuery("")}
            className="text-muted-foreground hover:text-foreground absolute end-2 top-1/2 -translate-y-1/2"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="status-filter-all"
          aria-pressed={!filtered}
          onClick={onClear}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
            !filtered
              ? "border-primary/40 bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          {t("calendar.filterAll")}
        </button>
        {STATUS_ORDER.map((s) => {
          const active = statuses.has(s);
          return (
            <button
              key={s}
              type="button"
              data-testid={`status-filter-${s}`}
              aria-pressed={active}
              onClick={() => onToggleStatus(s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
                active
                  ? "border-foreground/20 bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", STATUS_DOT[s])}
                aria-hidden
              />
              {t(`status.${s}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
