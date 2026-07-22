"use client";

import { useTranslations } from "next-intl";
import type { CourseStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const STYLES: Record<CourseStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PUBLISHED:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  ARCHIVED:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
};

/** A small pill for a course's lifecycle status. */
export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  const t = useTranslations("courses");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[status],
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}
