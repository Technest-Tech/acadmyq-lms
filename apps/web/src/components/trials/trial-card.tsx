"use client";

import {
  Ban,
  CalendarClock,
  Check,
  MessageCircle,
  MoreHorizontal,
  RotateCcw,
  StickyNote,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TrialRow, TrialStatus } from "@/lib/api";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { StudentTimeNote } from "./student-clock";

/**
 * The pieces every trials list shares — the table rows and the phone cards draw a trial with the
 * same status words, the same buttons and the same menu, so the two can never disagree.
 */

/**
 * Where a trial stands right now. A SCHEDULED trial is three different things depending on the
 * clock — still ahead, happening, or over with nobody saying how it went — and only the last one
 * is somebody's unfinished job, so it is the only one painted red.
 */
export type TrialPhase =
  | "upcoming"
  | "live"
  | "overdue"
  | Exclude<TrialStatus, "SCHEDULED">;

export function trialPhase(trial: TrialRow, now: number): TrialPhase {
  if (trial.status !== "SCHEDULED") return trial.status;
  if (now >= new Date(trial.ends_at_utc).getTime()) return "overdue";
  if (now >= new Date(trial.scheduled_at_utc).getTime()) return "live";
  return "upcoming";
}

/** The status chip per phase, and the colour bar at the row's start (only where a hand is owed). */
const PHASE_TONE: Record<TrialPhase, { chip: string; bar: string | null }> = {
  upcoming: {
    chip: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
    bar: null,
  },
  live: {
    chip: "bg-amber-500/15 text-amber-800 ring-amber-500/25 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  overdue: { chip: "bg-rose-600 text-white ring-rose-600", bar: "bg-rose-500" },
  COMPLETED: {
    chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
    bar: null,
  },
  NO_SHOW: {
    chip: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300",
    bar: null,
  },
  CONVERTED: { chip: "bg-primary/10 text-primary ring-primary/20", bar: null },
  CANCELLED: {
    chip: "bg-slate-400/10 text-slate-600 ring-slate-400/20 dark:text-slate-400",
    bar: null,
  },
};

export function phaseBar(phase: TrialPhase): string | null {
  return PHASE_TONE[phase].bar;
}

export interface TrialHandlers {
  /** One tap: the prospect came, or did not. */
  onDecide: (trial: TrialRow, status: "COMPLETED" | "NO_SHOW") => void;
  /** Clear a recorded decision — the trial goes back to waiting. */
  onReopen: (trial: TrialRow) => void;
  /** Move the slot; for a no-show or cancelled trial this is "book again". */
  onReschedule: (trial: TrialRow) => void;
  onNotes: (trial: TrialRow) => void;
  onConvert: (trial: TrialRow) => void;
  onCancel: (trial: TrialRow) => void;
  onDelete: (trial: TrialRow) => void;
}

/** wa.me wants the number as bare digits. */
function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
}

/** Upcoming within this window shows "in 40 minutes" beside its chip — the day's next trials. */
const SOON_MS = 12 * 60 * 60 * 1000;

/**
 * Where the trial stands, in words: "قادمة · بعد ٤٠ دقيقة", "جارية الآن", "بانتظار قرار · منذ
 * ساعتين", "حضر", "لم يحضر", "أصبح طالبًا", "ملغاة".
 */
export function TrialStatusChip({
  trial,
  phase,
  now,
}: {
  trial: TrialRow;
  phase: TrialPhase;
  now: number;
}) {
  const t = useTranslations("trials.phase");
  const locale = useLocale();
  const start = new Date(trial.scheduled_at_utc).getTime();
  const relative =
    phase === "overdue"
      ? formatRelativeTime(trial.ends_at_utc, locale)
      : phase === "upcoming" && start - now < SOON_MS
        ? formatRelativeTime(trial.scheduled_at_utc, locale)
        : null;

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        data-testid="trial-phase"
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
          PHASE_TONE[phase].chip,
        )}
      >
        {phase === "live" && (
          <span className="relative flex size-1.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
          </span>
        )}
        {t(phase)}
      </span>
      {relative && (
        <span className="text-muted-foreground text-[11px]">{relative}</span>
      )}
    </span>
  );
}

/** "٥:٠٠ م · ٣٠ د", then the hour at the student's home when they live on another clock. */
export function TrialWhen({
  trial,
  timezone,
}: {
  trial: TrialRow;
  timezone: string;
}) {
  const t = useTranslations("trials.table");
  const locale = useLocale();
  const timeFmt = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className="font-semibold tabular-nums">
        {timeFmt.format(new Date(trial.scheduled_at_utc))}
      </span>
      <span className="text-muted-foreground text-[11px]">
        {t("minutes", { count: trial.duration_minutes })}
      </span>
      <StudentTimeNote
        timezone={trial.student_timezone}
        country={trial.student_country}
        at={trial.scheduled_at_utc}
        className="text-[11px]"
      />
    </span>
  );
}

/** The name, with a note icon carrying the trial's notes on hover when there are any. */
export function TrialName({
  trial,
  className,
}: {
  trial: TrialRow;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span
        className={cn(
          "truncate font-medium",
          trial.status === "CANCELLED" && "text-muted-foreground line-through",
        )}
        title={
          trial.contact_whatsapp
            ? `${trial.display_name ?? ""} · ${trial.contact_whatsapp}`
            : undefined
        }
      >
        {trial.display_name ?? "—"}
      </span>
      {trial.outcome_notes && (
        <span
          title={trial.outcome_notes}
          className="inline-flex shrink-0"
          data-testid="trial-has-notes"
        >
          <StickyNote
            className="text-muted-foreground size-3.5"
            aria-label={trial.outcome_notes}
          />
        </span>
      )}
    </span>
  );
}

/**
 * The row's buttons. The next thing to do is a button — ✓ Attended / ✗ No-show once the slot has
 * started, "convert to student" for a prospect who came, "book again" after a no-show — and
 * everything rarer sits behind ⋯. Decision buttons never show on a trial that has not started:
 * nobody can know how a future trial went.
 */
export function TrialActions({
  trial,
  phase,
  handlers,
  canManage,
  busy,
  className,
}: {
  trial: TrialRow;
  phase: TrialPhase;
  handlers: TrialHandlers;
  canManage: boolean;
  busy: boolean;
  className?: string;
}) {
  const t = useTranslations("trials.actions");
  const started = phase === "live" || phase === "overdue";
  const { status } = trial;
  const decided = status === "COMPLETED" || status === "NO_SHOW";
  const canConvertFromMenu =
    trial.is_lead && (status === "SCHEDULED" || status === "NO_SHOW");
  const canCancel = status !== "CONVERTED" && status !== "CANCELLED";

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      {busy && (
        <span
          className="text-muted-foreground size-3.5 animate-spin rounded-full border border-current border-t-transparent"
          aria-hidden
        />
      )}

      {canManage && started && (
        <>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => handlers.onDecide(trial, "COMPLETED")}
            className="gap-1 border-transparent bg-emerald-600 text-white hover:bg-emerald-700"
            data-testid="trial-attended"
          >
            <Check className="size-3.5" aria-hidden />
            {t("attended")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => handlers.onDecide(trial, "NO_SHOW")}
            className="gap-1 border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-950/30"
            data-testid="trial-no-show"
          >
            <X className="size-3.5" aria-hidden />
            {t("noShow")}
          </Button>
        </>
      )}

      {canManage && status === "COMPLETED" && trial.is_lead && (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => handlers.onConvert(trial)}
          className="gap-1"
          data-testid="trial-convert"
        >
          <UserPlus className="size-3.5" aria-hidden />
          {t("convert")}
        </Button>
      )}

      {canManage && (status === "NO_SHOW" || status === "CANCELLED") && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => handlers.onReschedule(trial)}
          className="gap-1"
          data-testid="trial-rebook"
        >
          <CalendarClock className="size-3.5" aria-hidden />
          {t("rebook")}
        </Button>
      )}

      {trial.contact_whatsapp && (
        <a
          href={waLink(trial.contact_whatsapp)}
          target="_blank"
          rel="noreferrer"
          title={`${t("message")} · ${trial.contact_whatsapp}`}
          aria-label={t("message")}
          className="inline-flex size-7 items-center justify-center rounded-lg text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
          data-testid="trial-whatsapp"
        >
          <MessageCircle className="size-4" aria-hidden />
        </a>
      )}

      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("more")}
              data-testid="trial-more"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {status === "SCHEDULED" && (
              <DropdownMenuItem
                onClick={() => handlers.onReschedule(trial)}
                data-testid="trial-reschedule"
              >
                <CalendarClock aria-hidden />
                {t("reschedule")}
              </DropdownMenuItem>
            )}
            {decided && (
              <DropdownMenuItem
                onClick={() => handlers.onReopen(trial)}
                data-testid="trial-reopen"
              >
                <RotateCcw aria-hidden />
                {t("reopen")}
              </DropdownMenuItem>
            )}
            {canConvertFromMenu && (
              <DropdownMenuItem onClick={() => handlers.onConvert(trial)}>
                <UserPlus aria-hidden />
                {t("convert")}
              </DropdownMenuItem>
            )}
            {status !== "CONVERTED" && (
              <DropdownMenuItem onClick={() => handlers.onNotes(trial)}>
                <StickyNote aria-hidden />
                {t("notes")}
              </DropdownMenuItem>
            )}
            {status !== "CONVERTED" && <DropdownMenuSeparator />}
            {canCancel && (
              <DropdownMenuItem
                onClick={() => handlers.onCancel(trial)}
                data-testid="trial-cancel"
              >
                <Ban aria-hidden />
                {t("cancel")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              destructive
              onClick={() => handlers.onDelete(trial)}
              data-testid="trial-delete"
            >
              <Trash2 aria-hidden />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** One trial on a phone or tablet: the table row's answers in three short lines. */
export function TrialRowCard({
  trial,
  timezone,
  now,
  handlers,
  canManage,
  busy,
}: {
  trial: TrialRow;
  timezone: string;
  now: number;
  handlers: TrialHandlers;
  canManage: boolean;
  busy: boolean;
}) {
  const phase = trialPhase(trial, now);
  const bar = phaseBar(phase);
  return (
    <article
      data-testid="trial-card"
      data-phase={phase}
      className={cn(
        "bg-card relative min-w-0 space-y-1.5 overflow-hidden rounded-xl border px-3.5 py-3 shadow-sm",
        phase === "overdue" && "border-rose-200 dark:border-rose-900/60",
        phase === "CANCELLED" && "opacity-70",
      )}
    >
      {bar && (
        <span
          className={cn("absolute inset-y-2 start-0 w-1 rounded-e-full", bar)}
          aria-hidden
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <TrialName trial={trial} className="text-sm" />
        <TrialStatusChip trial={trial} phase={phase} now={now} />
      </div>
      <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="text-foreground">
          <TrialWhen trial={trial} timezone={timezone} />
        </span>
        <span aria-hidden>·</span>
        <span className="truncate">{trial.teacher_name ?? "—"}</span>
      </p>
      <TrialActions
        trial={trial}
        phase={phase}
        handlers={handlers}
        canManage={canManage}
        busy={busy}
        className="flex-wrap justify-end pt-0.5"
      />
    </article>
  );
}
