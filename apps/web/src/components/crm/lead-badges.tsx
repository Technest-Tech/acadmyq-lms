"use client";

import { CalendarClock, GraduationCap, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { LeadRow, LeadSource, LeadStatus, TrialStatus } from "@/lib/api";
import { formatLocalDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Shared CRM presentation atoms: status/source tones, the follow-up chip, the wa.me link. */

export const STATUS_TONE: Record<LeadStatus, string> = {
  NEW: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400",
  CONTACTED: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-400",
  INTERESTED: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
  TRIAL: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-400",
  SUBSCRIBED: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  LOST: "bg-slate-400/10 text-slate-600 ring-slate-400/20 dark:text-slate-400",
};

/** The little pipeline-column dot, matching STATUS_TONE. */
export const STATUS_DOT: Record<LeadStatus, string> = {
  NEW: "bg-blue-500",
  CONTACTED: "bg-violet-500",
  INTERESTED: "bg-amber-500",
  TRIAL: "bg-sky-500",
  SUBSCRIBED: "bg-emerald-500",
  LOST: "bg-slate-400",
};

/** A lead in one of these stages is finished with — no follow-up is "due" on it. */
export function isClosed(status: LeadStatus): boolean {
  return status === "SUBSCRIBED" || status === "LOST";
}

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

const TRIAL_TONE: Record<TrialStatus, string> = {
  SCHEDULED: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-400",
  COMPLETED: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  NO_SHOW: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
  CANCELLED: "bg-muted text-muted-foreground ring-border",
  CONVERTED: "bg-primary/10 text-primary ring-primary/20",
};

/**
 * The lead's booked trial, in one line: when it is, who is taking it, and where it got to.
 * Rendered wherever a lead is — board card, list row, detail header — because "did the trial
 * happen?" is the only question that matters at this stage of the pipeline.
 */
export function TrialChip({ lead }: { lead: LeadRow }) {
  const t = useTranslations("crm");
  const locale = useLocale();

  if (lead.trial_id === null || lead.trial_scheduled_at_utc === null) return null;
  const status = lead.trial_status ?? "SCHEDULED";

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
        TRIAL_TONE[status],
      )}
      title={t(`trial.chipTitle`, {
        status: t(`trialStatus.${status}`),
        teacher: lead.trial_teacher_name ?? "—",
      })}
      data-testid="crm-trial-chip"
    >
      <Sparkles className="size-3 shrink-0" aria-hidden />
      <span className="tabular-nums" dir="ltr">
        {formatLocalDateTime(lead.trial_scheduled_at_utc, locale)}
      </span>
      {lead.trial_teacher_name && (
        <>
          <GraduationCap className="size-3 shrink-0 opacity-70" aria-hidden />
          <span className="truncate">{lead.trial_teacher_name}</span>
        </>
      )}
      {status !== "SCHEDULED" && <span>· {t(`trialStatus.${status}`)}</span>}
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
  /** A finished lead (subscribed/lost) no longer has a "due" follow-up — render neutrally. */
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
