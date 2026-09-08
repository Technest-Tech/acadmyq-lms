"use client";

import { useTranslations } from "next-intl";
import type { LearnOrderStatus } from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The one place an order status becomes a colour, shared by the list and the detail page so the
 * buyer never sees the same state rendered two different ways.
 */
const TONE: Record<LearnOrderStatus, string> = {
  AWAITING_PAYMENT:
    "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20",
  UNDER_REVIEW:
    "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20",
  REJECTED:
    "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/20",
  CANCELLED: "bg-muted text-muted-foreground ring-foreground/10",
  REFUNDED:
    "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-400/20",
};

export function OrderStatusPill({
  status,
  className,
}: {
  status: LearnOrderStatus;
  className?: string;
}) {
  const t = useTranslations("learn");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        TONE[status],
        className,
      )}
    >
      {t(`orders.status.${status}`)}
    </span>
  );
}
