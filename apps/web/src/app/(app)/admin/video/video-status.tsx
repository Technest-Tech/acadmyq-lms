"use client";

import { useTranslations } from "next-intl";
import type { VideoAccessStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Pill colours per effective video access status. */
const STATUS_TONE: Record<VideoAccessStatus, string> = {
  ENABLED: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  PLAN: "bg-sky-100 text-sky-700 ring-sky-600/20",
  TRIAL: "bg-amber-100 text-amber-700 ring-amber-600/20",
  EXPIRED: "bg-orange-100 text-orange-700 ring-orange-600/20",
  DISABLED: "bg-rose-100 text-rose-700 ring-rose-600/20",
  NONE: "bg-muted text-muted-foreground ring-foreground/10",
};

const DOT_TONE: Record<VideoAccessStatus, string> = {
  ENABLED: "bg-emerald-500",
  PLAN: "bg-sky-500",
  TRIAL: "bg-amber-500",
  EXPIRED: "bg-orange-500",
  DISABLED: "bg-rose-500",
  NONE: "bg-slate-400",
};

export function VideoStatusBadge({ status }: { status: VideoAccessStatus }) {
  const t = useTranslations("adminVideo");
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", STATUS_TONE[status])}>
      <span className={cn("size-1.5 rounded-full", DOT_TONE[status])} />
      {t(`status.${status}`)}
    </span>
  );
}
