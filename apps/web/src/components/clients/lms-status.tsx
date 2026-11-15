"use client";

import { useTranslations } from "next-intl";
import type { LmsCourseStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

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
