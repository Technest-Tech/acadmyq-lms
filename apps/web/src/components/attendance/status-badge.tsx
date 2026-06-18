"use client";

import { useTranslations } from "next-intl";
import type { SessionStatus } from "@academiq/contracts";
import { cn } from "@/lib/utils";

/** Outcome → pill colour. Billable outcomes lean amber/green; cancellations/absence lean slate. */
const STATUS_STYLES: Record<SessionStatus, string> = {
  SCHEDULED:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  ATTENDED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  FREE:
    "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  ABSENT_UNEXCUSED:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  ABSENT_EXCUSED:
    "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300",
  CANCELLED_BY_TEACHER:
    "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300",
  CANCELLED_BY_STUDENT:
    "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300",
  RESCHEDULED:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
};

export function StatusBadge({
  status,
  className,
}: {
  status: SessionStatus;
  className?: string;
}) {
  const ts = useTranslations("scheduling");

  return (
    <span
      data-testid="status-badge"
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
    >
      {ts(`status.${status}`)}
    </span>
  );
}
