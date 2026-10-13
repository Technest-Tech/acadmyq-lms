"use client";

import { AlarmClock, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TrialCard, type TrialHandlers } from "@/components/trials/trial-card";
import type { TrialRow } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Rows shown before the panel has to be expanded. */
const COLLAPSED_ROWS = 4;

/**
 * Trials whose slot ENDED with nobody saying whether the prospect came — on any day, oldest first.
 *
 * The trials-side twin of the attendance page's الحصص المعلقة panel, and just as loud: the board
 * below can only show the day you picked, so a trial forgotten last Tuesday is invisible there the
 * moment the page moves on. Each row carries the decision buttons, so clearing the backlog is a
 * tap per trial — and the staff WhatsApp group keeps being told about it until somebody does.
 *
 * Renders nothing when the queue is empty: a clean slate does not need a green box every day.
 */
export function TrialsNeedsDecisionPanel({
  trials,
  count,
  timezone,
  now,
  handlers,
  canManage,
  busyId,
}: {
  trials: TrialRow[];
  /** The true count — `trials` is capped server-side. */
  count: number;
  timezone: string;
  now: number;
  handlers: TrialHandlers;
  canManage: boolean;
  busyId: string | null;
}) {
  const t = useTranslations("trials");
  const [expanded, setExpanded] = useState(false);

  if (count === 0) return null;

  const shown = expanded ? trials : trials.slice(0, COLLAPSED_ROWS);
  const hidden = trials.length - shown.length;

  return (
    <section
      data-testid="trials-needs-decision"
      aria-label={t("needs.title")}
      className="overflow-hidden rounded-2xl border-2 border-rose-300 bg-rose-50/70 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/20"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-rose-200 px-4 py-3.5 sm:px-5 dark:border-rose-900/50">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 ring-1 ring-rose-500/25">
          <AlarmClock className="size-4 text-rose-600 dark:text-rose-400" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-bold text-rose-900 dark:text-rose-100">
            {t("needs.title")}
            <span
              data-testid="trials-needs-decision-count"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold tabular-nums text-white"
            >
              {count.toLocaleString()}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-rose-700/90 dark:text-rose-300/90">{t("needs.subtitle")}</p>
        </div>
      </div>

      <ul className="space-y-2.5 p-3 sm:p-4">
        {shown.map((trial) => (
          <li key={trial.id}>
            <TrialCard
              trial={trial}
              timezone={timezone}
              now={now}
              handlers={handlers}
              canManage={canManage}
              busy={busyId === trial.id}
              showDay
            />
          </li>
        ))}
      </ul>

      {(hidden > 0 || expanded || count > trials.length) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rose-200 px-5 py-2.5 dark:border-rose-900/50">
          {(hidden > 0 || expanded) && (
            <button
              type="button"
              data-testid="trials-needs-decision-toggle"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline dark:text-rose-300"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
              {expanded ? t("needs.showLess") : t("needs.showAll", { count: hidden })}
            </button>
          )}
          {count > trials.length && (
            <p className="text-[11px] text-rose-700/80 dark:text-rose-300/80">
              {t("needs.truncated", { shown: trials.length, total: count })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
