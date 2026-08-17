import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one status pill for the Super Admin surface (superadmin-reorg). The audit counted ~22
 * hand-rolled pill class strings across /admin; every ACTIVE/TRIAL/SUSPENDED/connected/paid
 * state renders through this component so tone → color is decided exactly once (with dark
 * variants, which most of the hand-rolled pills lacked).
 */
export type ChipTone = "good" | "warn" | "crit" | "info" | "accent" | "neutral";

const TONE_CLASS: Record<ChipTone, string> = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  crit: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  accent: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
};

/** Client/subscription lifecycle → tone, shared by the roster, client page and billing. */
export const SUBSCRIPTION_TONE: Record<string, ChipTone> = {
  ACTIVE: "good",
  TRIAL: "warn",
  SUSPENDED: "crit",
  PAUSED: "neutral",
  ENDED: "neutral",
};

export function StatusChip({
  tone = "neutral",
  dot = false,
  icon: Icon,
  title,
  className,
  children,
}: {
  tone?: ChipTone;
  /** Leading status dot — use for live/lifecycle states, skip for plain labels. */
  dot?: boolean;
  icon?: LucideIcon;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}
