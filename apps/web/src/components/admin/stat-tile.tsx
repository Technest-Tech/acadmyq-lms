import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one KPI tile for the Super Admin surface (superadmin-reorg): flat card, muted icon,
 * tabular value, optional tone-colored sub line; pass `href` to make the whole tile a link.
 * Replaces the 12 tile shapes the audit found (KpiCard, OpsCard, StatCard, four `Stat`
 * copies, MiniStat, Fact, …) — and retires their per-tile gradient icon squares.
 */
const SUB_TONE: Record<string, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  crit: "text-rose-600 dark:text-rose-400",
  neutral: "text-muted-foreground",
};

export function StatTile({
  label,
  value,
  sub,
  subTone = "neutral",
  icon: Icon,
  href,
  loading = false,
  className,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: "good" | "warn" | "crit" | "neutral";
  icon?: LucideIcon;
  href?: string;
  loading?: boolean;
  className?: string;
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground truncate text-xs font-medium">
          {label}
        </span>
        {Icon && (
          <Icon className="text-muted-foreground/70 size-4 shrink-0" aria-hidden />
        )}
      </div>
      {loading ? (
        <div className="bg-muted mt-2 h-7 w-16 animate-pulse rounded-md" aria-hidden />
      ) : (
        <p className="mt-1.5 truncate text-2xl font-bold tracking-tight tabular-nums" dir="ltr">
          {value}
        </p>
      )}
      {sub && (
        <p className={cn("mt-0.5 truncate text-xs", SUB_TONE[subTone])}>{sub}</p>
      )}
    </>
  );

  const base =
    "bg-card block min-w-0 rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]";

  if (href) {
    return (
      <Link
        href={href}
        data-testid={testId}
        className={cn(base, "transition-shadow hover:shadow-md", className)}
      >
        {body}
      </Link>
    );
  }
  return (
    <div data-testid={testId} className={cn(base, className)}>
      {body}
    </div>
  );
}
