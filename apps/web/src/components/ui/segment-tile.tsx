"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/**
 * One cut of a list, as a BUTTON. A tile reads out a count and, pressed, narrows the table below
 * it to exactly the rows behind that count — the number and the list are driven by the same
 * server filter, so they can never disagree.
 *
 * This replaced the decorative stat cards that sat above every list: four numbers that answered
 * nothing you could act on, and that quietly drifted from the table under them as soon as anyone
 * touched a filter.
 *
 * The bar is the segment's share of the whole — the context a bare number never carries ("41
 * trials" means something different at an academy of 60 than at one of 6,000).
 */
export const TILE_TONES = {
  emerald: {
    icon: "text-primary",
    chip: "bg-primary/10 ring-primary/20",
    bar: "bg-primary",
    wash: "from-primary/[0.07]",
  },
  teal: {
    icon: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/10 ring-emerald-500/20",
    bar: "bg-emerald-500",
    wash: "from-emerald-500/[0.07]",
  },
  gold: {
    icon: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10 ring-amber-500/20",
    bar: "bg-amber-500",
    wash: "from-amber-500/[0.08]",
  },
  violet: {
    icon: "text-violet-500",
    chip: "bg-violet-500/10 ring-violet-500/20",
    bar: "bg-violet-500",
    wash: "from-violet-500/[0.08]",
  },
  slate: {
    icon: "text-slate-500 dark:text-slate-400",
    chip: "bg-slate-400/10 ring-slate-400/20",
    bar: "bg-slate-400",
    wash: "from-slate-400/[0.07]",
  },
} as const;

export type TileTone = keyof typeof TILE_TONES;

export function SegmentTile({
  testKey,
  icon: Icon,
  label,
  hint,
  value,
  share,
  tone = "emerald",
  selected,
  onSelect,
}: {
  /** Stable handle for tests — never the translated label. */
  testKey: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  value: number | null;
  /** Percentage of the whole list, or null when this tile IS the whole list. */
  share: number | null;
  tone?: TileTone;
  selected: boolean;
  onSelect: () => void;
}) {
  const c = TILE_TONES[tone];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`segment-${testKey}`}
      className={cn(
        "group bg-card relative overflow-hidden rounded-xl border p-3.5 text-start transition-all",
        "bg-gradient-to-br to-transparent hover:shadow-md",
        c.wash,
        selected
          ? "border-primary/40 ring-primary/25 shadow-sm ring-2"
          : "hover:border-primary/25",
      )}
    >
      {/* The gold hairline marks the chosen cut — the same thread the sidebar and the panel
          headers use, so "selected" is stated in the frame's own vocabulary. */}
      {selected && (
        <span
          className="via-gold absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
          aria-hidden
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
            c.chip,
          )}
        >
          <Icon className={cn("size-4", c.icon)} aria-hidden />
        </div>
        {share !== null && (
          <span className="text-muted-foreground/70 text-[10px] font-semibold tabular-nums">
            {share}%
          </span>
        )}
      </div>

      <div className="mt-2.5">
        {value === null ? (
          <div className="bg-muted h-7 w-14 animate-pulse rounded" />
        ) : (
          <div className="text-2xl font-bold leading-none tracking-tight tabular-nums">
            {value.toLocaleString()}
          </div>
        )}
        <div className="text-foreground/90 mt-1.5 text-xs font-semibold">{label}</div>
        {hint && (
          <div className="text-muted-foreground truncate text-[11px]">{hint}</div>
        )}
      </div>

      {/* Share of the whole. The track always renders so the tiles keep one baseline. */}
      <div className="bg-muted mt-2.5 h-1 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all duration-500", c.bar)}
          style={{ width: `${share ?? 100}%` }}
        />
      </div>
    </button>
  );
}
