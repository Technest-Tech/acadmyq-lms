import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A stat card's colour: a wash of it behind the card, a solid icon chip, the figure in it. */
const STAT_TONES = {
  rose: {
    card: "border-rose-200/80 from-rose-500/[0.13] via-rose-500/[0.04] dark:border-rose-900/50",
    chip: "from-rose-500 to-rose-600 shadow-rose-500/25",
    value: "text-rose-700 dark:text-rose-300",
    bar: "bg-rose-500",
  },
  amber: {
    card: "border-amber-200/80 from-amber-500/[0.14] via-amber-500/[0.04] dark:border-amber-900/50",
    chip: "from-amber-500 to-orange-500 shadow-amber-500/25",
    value: "text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  sky: {
    card: "border-sky-200/80 from-sky-500/[0.13] via-sky-500/[0.04] dark:border-sky-900/50",
    chip: "from-sky-500 to-blue-600 shadow-sky-500/25",
    value: "text-sky-700 dark:text-sky-300",
    bar: "bg-sky-500",
  },
  violet: {
    card: "border-violet-200/80 from-violet-500/[0.13] via-violet-500/[0.04] dark:border-violet-900/50",
    chip: "from-violet-500 to-purple-600 shadow-violet-500/25",
    value: "text-violet-700 dark:text-violet-300",
    bar: "bg-violet-500",
  },
  emerald: {
    card: "border-emerald-200/80 from-emerald-500/[0.13] via-emerald-500/[0.04] dark:border-emerald-900/50",
    chip: "from-emerald-500 to-teal-600 shadow-emerald-500/25",
    value: "text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
} as const;

export type StatTone = keyof typeof STAT_TONES;

/**
 * One coloured stat card: the label and a solid icon chip on top, the figure large under them (one
 * line per currency — money is never summed across currencies, and never truncated: it wraps).
 * Compact (Ahmed 2026-11-22: "why so big"): the chip beside the figures, currencies side by side.
 */
export function StatCard({
  tone,
  icon: Icon,
  label,
  values,
  hint,
  testId,
  onClick,
  active,
}: {
  tone: StatTone;
  icon: LucideIcon;
  label: string;
  values: string[];
  hint?: string;
  testId?: string;
  /** Makes the card a filter button: the page shows only what the card counts. */
  onClick?: () => void;
  /** This card's filter is the one applied. */
  active?: boolean;
}) {
  const s = STAT_TONES[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": active ?? false } : {})}
      className={cn(
        "bg-card relative flex items-center gap-3 overflow-hidden rounded-xl border bg-gradient-to-br to-transparent px-3.5 py-2.5 text-start shadow-sm",
        s.card,
        onClick && "hover:ring-foreground/10 cursor-pointer transition-shadow hover:ring-2",
        active && "ring-primary/60 hover:ring-primary/60 ring-2",
      )}
      data-testid={testId}
    >
      <span className={cn("absolute inset-y-2.5 start-0 w-1 rounded-e-full", s.bar)} aria-hidden />
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm", s.chip)}>
        <Icon className="size-4" aria-hidden />
      </span>
      {/* Spans, not div/p: the card may be a button, which takes phrasing content only. */}
      <span className="block min-w-0 flex-1">
        <span className="text-muted-foreground block truncate text-[11px] font-semibold">{label}</span>
        <span className={cn("flex flex-wrap items-baseline gap-x-2.5 leading-tight font-bold tabular-nums", s.value)}>
          {values.map((v) => (
            <span key={v} className={cn("break-words", values.length > 1 ? "text-sm" : "text-lg")}>
              {v}
            </span>
          ))}
          {hint && <span className="text-muted-foreground text-[11px] font-medium">{hint}</span>}
        </span>
      </span>
    </Tag>
  );
}
