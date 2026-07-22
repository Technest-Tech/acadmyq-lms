"use client";

import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LeadSource, LeadStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Shared CRM presentation atoms: status/source tones, the follow-up chip, the wa.me link. */

export const STATUS_TONE: Record<LeadStatus, string> = {
  NEW: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400",
  CONTACTED: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-400",
  INTERESTED: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
  WON: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  LOST: "bg-slate-400/10 text-slate-600 ring-slate-400/20 dark:text-slate-400",
};

/** The little pipeline-column dot, matching STATUS_TONE. */
export const STATUS_DOT: Record<LeadStatus, string> = {
  NEW: "bg-blue-500",
  CONTACTED: "bg-violet-500",
  INTERESTED: "bg-amber-500",
  WON: "bg-emerald-500",
  LOST: "bg-slate-400",
};

/** Digits-only wa.me deep link (drops +, spaces, dashes); null when there's no phone. */
export function waLink(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  const t = useTranslations("crm");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
        STATUS_TONE[status],
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

export function SourceBadge({ source }: { source: LeadSource }) {
  const t = useTranslations("crm");
  return (
    <span className="bg-muted text-muted-foreground ring-border inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1">
      {t(`source.${source}`)}
    </span>
  );
}

/**
 * The follow-up date chip. Red once the promised date has passed, amber on the day itself,
 * muted for the future — `today` is the academy-local date the server sent (falls back to the
 * browser's date), so "overdue" flips exactly when the academy's own day does.
 */
export function FollowUpChip({
  date,
  today,
  closed,
}: {
  date: string | null;
  today?: string;
  /** WON/LOST leads no longer have "due" follow-ups — render neutrally. */
  closed?: boolean;
}) {
  const t = useTranslations("crm");
  if (!date) return null;

  const ref = today ?? new Date().toISOString().slice(0, 10);
  const overdue = !closed && date < ref;
  const dueToday = !closed && date === ref;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 tabular-nums",
        overdue
          ? "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400"
          : dueToday
            ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
            : "bg-muted text-muted-foreground ring-border",
      )}
      title={overdue ? t("followUp.overdue") : dueToday ? t("followUp.today") : t("followUp.label")}
    >
      <CalendarClock className="size-3" aria-hidden />
      <span dir="ltr">{date}</span>
      {overdue && <span>• {t("followUp.overdue")}</span>}
      {dueToday && <span>• {t("followUp.today")}</span>}
    </span>
  );
}
