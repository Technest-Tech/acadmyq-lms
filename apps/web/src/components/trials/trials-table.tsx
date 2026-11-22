"use client";

import { useLocale, useTranslations } from "next-intl";
import { DoneByCell } from "@/components/team/done-by";
import type { TrialRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  phaseBar,
  TrialActions,
  TrialName,
  trialPhase,
  TrialRowCard,
  TrialStatusChip,
  TrialWhen,
  type TrialHandlers,
} from "./trial-card";
import { addDays, dayAsDate, dayIn } from "./trial-time";

/**
 * The trials list (Ahmed 2026-11-22: "the trials page is a mess, too many details — redo it for
 * daily use"). One compact coloured table for every view of the page — today, waiting for a
 * decision, upcoming, the whole record — one line per trial: who, when, with whom, where it
 * stands, and the next thing to do. Lists that span days get a slim header row per day, so the
 * time column never has to repeat the date. Phones and tablets get the same rows as cards.
 */

interface DayGroup {
  day: string;
  rows: TrialRow[];
}

/** Consecutive rows of the same academy day, in the order given. */
function groupByDay(rows: TrialRow[], timezone: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const day = dayIn(row.scheduled_at_utc, timezone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

/** "اليوم · السبت ٢٢ نوفمبر", "غدًا · …", or just the date. */
function useDayLabel(today: string) {
  const t = useTranslations("trials.list");
  const locale = useLocale();
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return (day: string) => {
    const date = fmt.format(dayAsDate(day));
    const near =
      day === today
        ? t("today")
        : day === addDays(today, 1)
          ? t("tomorrow")
          : day === addDays(today, -1)
            ? t("yesterday")
            : null;
    return near ? `${near} · ${date}` : date;
  };
}

const HEAD = "px-3 py-2 text-start text-[11px] font-semibold whitespace-nowrap";
const CELL = "px-3 py-2 whitespace-nowrap";

export function TrialsTable({
  rows,
  timezone,
  today,
  grouped,
  now,
  handlers,
  canManage,
  busyId,
  showAddedBy,
}: {
  rows: TrialRow[];
  timezone: string;
  /** The academy's today, for "today / tomorrow / yesterday" on the day rows. */
  today: string;
  /** Put a header row over each day — for lists that span days. */
  grouped: boolean;
  now: number;
  handlers: TrialHandlers;
  canManage: boolean;
  busyId: string | null;
  /** The "added by" column — staff only (a teacher sees no team names). */
  showAddedBy: boolean;
}) {
  const t = useTranslations("trials");
  const tDone = useTranslations("doneBy");
  const dayLabel = useDayLabel(today);
  const groups = grouped ? groupByDay(rows, timezone) : [{ day: "", rows }];
  const columns = showAddedBy ? 6 : 5;

  return (
    <>
      {/* ── Laptop and up: the table ─────────────────────────────────── */}
      <section
        className="bg-card hidden overflow-hidden rounded-xl border shadow-sm lg:block"
        data-testid="trials-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="from-primary/[0.09] via-primary/[0.035] text-muted-foreground border-b bg-gradient-to-l to-transparent">
                <th className={cn(HEAD, "ps-4")}>{t("table.name")}</th>
                <th className={HEAD}>{t("table.when")}</th>
                <th className={HEAD}>{t("table.teacher")}</th>
                <th className={HEAD}>{t("table.status")}</th>
                {showAddedBy && <th className={HEAD}>{tDone("col")}</th>}
                <th className={cn(HEAD, "pe-4 text-end")}>
                  <span className="sr-only">{t("list.actions")}</span>
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.day || "all"}>
                {grouped && (
                  <tr
                    className="bg-muted/50 border-t"
                    data-testid="trials-day-row"
                  >
                    <th
                      colSpan={columns}
                      scope="colgroup"
                      className="text-foreground/80 px-4 py-1.5 text-start text-xs font-semibold"
                    >
                      {dayLabel(group.day)}
                    </th>
                  </tr>
                )}
                {group.rows.map((trial) => {
                  const phase = trialPhase(trial, now);
                  const bar = phaseBar(phase);
                  return (
                    <tr
                      key={trial.id}
                      data-testid="trial-row"
                      data-phase={phase}
                      className={cn(
                        "hover:bg-primary/[0.04] border-border/50 border-t transition-colors",
                        phase === "overdue" &&
                          "bg-rose-50/60 dark:bg-rose-950/20",
                        phase === "CANCELLED" && "opacity-60",
                      )}
                    >
                      <td className={cn(CELL, "relative max-w-60 ps-4")}>
                        {bar && (
                          <span
                            className={cn(
                              "absolute inset-y-1.5 start-0 w-1 rounded-e-full",
                              bar,
                            )}
                            aria-hidden
                          />
                        )}
                        <TrialName trial={trial} className="max-w-full" />
                      </td>
                      <td className={CELL}>
                        <TrialWhen trial={trial} timezone={timezone} />
                      </td>
                      <td className={cn(CELL, "max-w-44 truncate text-xs")}>
                        {trial.teacher_name ?? "—"}
                      </td>
                      <td className={CELL}>
                        <TrialStatusChip
                          trial={trial}
                          phase={phase}
                          now={now}
                        />
                      </td>
                      {showAddedBy && (
                        <td className={cn(CELL, "max-w-36")}>
                          <DoneByCell name={trial.added_by_name} />
                        </td>
                      )}
                      <td className={cn(CELL, "pe-4")}>
                        <TrialActions
                          trial={trial}
                          phase={phase}
                          handlers={handlers}
                          canManage={canManage}
                          busy={busyId === trial.id}
                          className="justify-end"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      {/* ── Phones and tablets: the same rows as cards ───────────────── */}
      <div className="space-y-4 lg:hidden" data-testid="trials-cards">
        {groups.map((group) => (
          <div key={group.day || "all"} className="space-y-2">
            {grouped && (
              <h3 className="text-muted-foreground px-1 text-xs font-semibold">
                {dayLabel(group.day)}
              </h3>
            )}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {group.rows.map((trial) => (
                <TrialRowCard
                  key={trial.id}
                  trial={trial}
                  timezone={timezone}
                  now={now}
                  handlers={handlers}
                  canManage={canManage}
                  busy={busyId === trial.id}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
