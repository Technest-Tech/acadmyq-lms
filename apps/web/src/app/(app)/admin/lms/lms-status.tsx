"use client";

import { useTranslations } from "next-intl";
import type { LmsCourseStatus, LmsStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Pill colours per effective LMS module status (derived from the LMS module subscription). */
const STATUS_TONE: Record<LmsStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  TRIAL: "bg-amber-100 text-amber-700 ring-amber-600/20",
  EXPIRED: "bg-orange-100 text-orange-700 ring-orange-600/20",
  PAUSED: "bg-rose-100 text-rose-700 ring-rose-600/20",
  NONE: "bg-muted text-muted-foreground ring-foreground/10",
};

const DOT_TONE: Record<LmsStatus, string> = {
  ACTIVE: "bg-emerald-500",
  TRIAL: "bg-amber-500",
  EXPIRED: "bg-orange-500",
  PAUSED: "bg-rose-500",
  NONE: "bg-slate-400",
};

export function LmsStatusBadge({ status }: { status: LmsStatus }) {
  const t = useTranslations("adminLms");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1",
        STATUS_TONE[status],
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT_TONE[status])} />
      {t(`status.${status}`)}
    </span>
  );
}

const COURSE_TONE: Record<LmsCourseStatus, string> = {
  PUBLISHED: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  DRAFT: "bg-muted text-muted-foreground ring-foreground/10",
  ARCHIVED: "bg-slate-200 text-slate-600 ring-slate-500/20",
};

export function CourseStatusBadge({ status }: { status: LmsCourseStatus }) {
  const t = useTranslations("adminLms");
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", COURSE_TONE[status])}>
      {t(`courseStatus.${status}`)}
    </span>
  );
}
