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
  UserRoundSearch,
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

/**
 * Where a trial stands right now. A SCHEDULED trial is three different things depending on the
 * clock — still ahead, happening, or over with nobody saying how it went — and only the last one
 * is somebody's unfinished job, so it is the only one painted red.
 */
export type TrialPhase = "upcoming" | "live" | "overdue" | Exclude<TrialStatus, "SCHEDULED">;

export function trialPhase(trial: TrialRow, now: number): TrialPhase {
  if (trial.status !== "SCHEDULED") return trial.status;
  if (now >= new Date(trial.ends_at_utc).getTime()) return "overdue";
  if (now >= new Date(trial.scheduled_at_utc).getTime()) return "live";
  return "upcoming";
}

/** The card's left rail and its chip, per phase. */
const PHASE_TONE: Record<TrialPhase, { rail: string; chip: string }> = {
  upcoming: {
    rail: "border-s-sky-400",
    chip: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  },
  live: {
    rail: "border-s-amber-400",
    chip: "bg-amber-500/15 text-amber-800 ring-amber-500/25 dark:text-amber-300",
  },
  overdue: {
    rail: "border-s-rose-500",
    chip: "bg-rose-600 text-white ring-rose-600",
  },
  COMPLETED: {
    rail: "border-s-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  },
  NO_SHOW: {
    rail: "border-s-orange-400",
    chip: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300",
  },
  CONVERTED: {
    rail: "border-s-primary",
    chip: "bg-primary/10 text-primary ring-primary/20",
  },
  CANCELLED: {
    rail: "border-s-slate-300 dark:border-s-slate-600",
    chip: "bg-slate-400/10 text-slate-600 ring-slate-400/20 dark:text-slate-400",
  },
};

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

/**
 * One trial, with the next thing to do on it as a button rather than a menu: a trial that has
 * started gets ✓ Attended / ✗ No-show right on the card, an attended prospect gets "convert to
 * student", a no-show gets "book again". Everything rarer sits behind the ⋯ menu.
 *
 * Decision buttons only appear once the slot has started — nobody can know a future trial's
 * outcome, and hiding them is cheaper than an "are you sure?".
 */
export function TrialCard({
  trial,
  timezone,
  now,
  handlers,
  canManage,
  busy,
  showDay = false,
  className,
}: {
  trial: TrialRow;
  timezone: string;
  now: number;
  handlers: TrialHandlers;
  canManage: boolean;
  /** This trial's decision is being saved. */
  busy: boolean;
  /** Print the date with the time — for lists that span days (the red panel). */
  showDay?: boolean;
  className?: string;
}) {
  const t = useTranslations("trials");
  const locale = useLocale();
  const phase = trialPhase(trial, now);
  const tone = PHASE_TONE[phase];
  const started = phase === "live" || phase === "overdue";

  const timeFmt = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    ...(showDay ? { weekday: "short", day: "numeric", month: "short" } : {}),
  });

  const phaseLabel =
    phase === "upcoming" || phase === "live" || phase === "overdue"
      ? t(`board.phase.${phase}`)
      : t(`status.${phase}`);

  return (
    <article
      data-testid="trial-card"
      data-phase={phase}
      className={cn(
        "bg-card rounded-xl border border-s-4 p-3 shadow-sm transition-colors sm:p-3.5",
        tone.rail,
        phase === "overdue" && "border-rose-200 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/20",
        phase === "CANCELLED" && "opacity-70",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "truncate text-sm font-semibold",
                phase === "CANCELLED" && "line-through",
              )}
            >
              {trial.display_name ?? "—"}
            </span>
            {trial.from_crm ? (
              <span className="bg-primary/10 text-primary ring-primary/20 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1">
                <UserRoundSearch className="size-2.5" aria-hidden />
                {t("table.crmTag")}
              </span>
            ) : !trial.is_lead ? (
              <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {t("board.studentTag")}
              </span>
            ) : null}
          </p>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
            {showDay && (
              <>
                <span className="tabular-nums">{timeFmt.format(new Date(trial.scheduled_at_utc))}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{trial.teacher_name ?? "—"}</span>
            <span aria-hidden>·</span>
            <span>{t("table.minutes", { count: trial.duration_minutes })}</span>
            {trial.contact_whatsapp && (
              <>
                <span aria-hidden>·</span>
                <a
                  href={waLink(trial.contact_whatsapp)}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  title={t("board.actions.message")}
                >
                  <MessageCircle className="size-3" aria-hidden />
                  {trial.contact_whatsapp}
                </a>
              </>
            )}
          </p>
        </div>

        <span
          data-testid="trial-phase"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
            tone.chip,
          )}
        >
          {phase === "live" && (
            <span className="relative flex size-1.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
            </span>
          )}
          {phaseLabel}
          {phase === "overdue" && (
            <span className="font-normal opacity-90">
              · {formatRelativeTime(trial.ends_at_utc, locale)}
            </span>
          )}
        </span>
      </div>

      {trial.outcome_notes && (
        <p className="text-muted-foreground mt-2 line-clamp-2 border-s-2 ps-2 text-xs italic">
          {trial.outcome_notes}
        </p>
      )}

      {canManage && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {started && (
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
                {t("board.actions.attended")}
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
                {t("board.actions.noShow")}
              </Button>
            </>
          )}

          {trial.status === "COMPLETED" && trial.is_lead && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => handlers.onConvert(trial)}
              className="gap-1"
              data-testid="trial-convert"
            >
              <UserPlus className="size-3.5" aria-hidden />
              {t("board.actions.convert")}
            </Button>
          )}

          {trial.status !== "CONVERTED" && trial.status !== "COMPLETED" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => handlers.onReschedule(trial)}
              className="gap-1"
              data-testid="trial-reschedule"
            >
              <CalendarClock className="size-3.5" aria-hidden />
              {trial.status === "NO_SHOW" || trial.status === "CANCELLED"
                ? t("board.actions.rebook")
                : t("board.actions.reschedule")}
            </Button>
          )}

          {(trial.status === "COMPLETED" || trial.status === "NO_SHOW") && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => handlers.onReopen(trial)}
              className="text-muted-foreground gap-1"
              data-testid="trial-reopen"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t("board.actions.reopen")}
            </Button>
          )}

          {busy && (
            <span
              className="text-muted-foreground size-3.5 animate-spin rounded-full border border-current border-t-transparent"
              aria-hidden
            />
          )}

          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="ms-auto"
                aria-label={t("board.actions.more")}
                data-testid="trial-more"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {trial.status !== "CONVERTED" && (
                <DropdownMenuItem onClick={() => handlers.onNotes(trial)}>
                  <StickyNote aria-hidden />
                  {t("board.actions.notes")}
                </DropdownMenuItem>
              )}
              {trial.status !== "CONVERTED" && trial.status !== "CANCELLED" && (
                <DropdownMenuItem onClick={() => handlers.onCancel(trial)}>
                  <Ban aria-hidden />
                  {t("table.cancel")}
                </DropdownMenuItem>
              )}
              {trial.status !== "CONVERTED" && <DropdownMenuSeparator />}
              <DropdownMenuItem destructive onClick={() => handlers.onDelete(trial)}>
                <Trash2 aria-hidden />
                {t("table.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </article>
  );
}
