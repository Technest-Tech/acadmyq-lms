"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo } from "react";
import { TrialCard, trialPhase, type TrialHandlers } from "@/components/trials/trial-card";
import { addDays, dayAsDate } from "@/components/trials/trial-time";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import type { TrialAgenda, TrialRow } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The board's own narrowing — by where a trial stands, on top of the picked day. */
export type AgendaFilter = "all" | "open" | "decided";

const FILTERS: AgendaFilter[] = ["all", "open", "decided"];

function matches(filter: AgendaFilter, trial: TrialRow): boolean {
  if (filter === "open") return trial.status === "SCHEDULED";
  if (filter === "decided") return trial.status !== "SCHEDULED";
  return true;
}

/**
 * The trials board: a week strip to pick a day, and that day as a time rail.
 *
 * Not a calendar grid on purpose. A day holds a handful of trials, each of which needs a person to
 * DO something (call them, mark them, convert them) — a grid of hour cells would spend the screen on
 * empty hours and squeeze the buttons out. The strip keeps the week in view (counts, and a red dot
 * on any day with an undecided trial); the rail gives every trial room for its actions, with a
 * "now" line through today so what is next is obvious at a glance.
 */
export function TrialAgendaBoard({
  agenda,
  loading,
  selectedDay,
  weekFrom,
  onSelectDay,
  filter,
  onFilter,
  teachers,
  teacherId,
  onTeacher,
  now,
  handlers,
  canManage,
  busyId,
}: {
  agenda: TrialAgenda | null;
  loading: boolean;
  selectedDay: string;
  /** First day of the strip (a Saturday). */
  weekFrom: string;
  onSelectDay: (day: string) => void;
  filter: AgendaFilter;
  onFilter: (f: AgendaFilter) => void;
  teachers: { id: string; full_name: string }[];
  teacherId: string;
  onTeacher: (id: string) => void;
  now: number;
  handlers: TrialHandlers;
  canManage: boolean;
  busyId: string | null;
}) {
  const t = useTranslations("trials");
  const locale = useLocale();
  const timezone = agenda?.timezone ?? "UTC";
  const today = agenda?.today ?? selectedDay;

  const days = useMemo(() => {
    const byDate = new Map((agenda?.days ?? []).map((d) => [d.date, d]));
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekFrom, i);
      return byDate.get(date) ?? { date, total: 0, needs_decision: 0 };
    });
  }, [agenda, weekFrom]);

  // Day strings are formatted as UTC noon in UTC, so no viewer timezone can shift the label.
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const dayNumFmt = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const longDayFmt = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const timeFmt = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit" });

  const visible = (agenda?.date === selectedDay ? agenda.trials : []).filter((tr) => matches(filter, tr));
  const isToday = selectedDay === today;
  // Where the "now" line goes: before the first trial that has not started yet.
  const nowIndex = isToday
    ? visible.findIndex((tr) => new Date(tr.scheduled_at_utc).getTime() > now)
    : -1;

  const monthLabel = (() => {
    const first = monthFmt.format(dayAsDate(weekFrom));
    const last = monthFmt.format(dayAsDate(addDays(weekFrom, 6)));
    return first === last ? first : `${first} – ${last}`;
  })();

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-sm" data-testid="trials-agenda">
      {/* ── Week navigation ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-5">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onSelectDay(addDays(selectedDay, -7))}
            aria-label={t("board.prevWeek")}
            data-testid="trials-prev-week"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onSelectDay(addDays(selectedDay, 7))}
            aria-label={t("board.nextWeek")}
            data-testid="trials-next-week"
          >
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Button>
        </div>
        <h2 className="text-sm font-bold tracking-tight">{monthLabel}</h2>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {!isToday && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onSelectDay(today)}
              data-testid="trials-today"
            >
              {t("board.today")}
            </Button>
          )}
          <label className="border-input bg-background focus-within:border-primary inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs">
            <CalendarDays className="text-muted-foreground size-3.5" aria-hidden />
            <span className="sr-only">{t("board.pickDate")}</span>
            <input
              type="date"
              value={selectedDay}
              onChange={(e) => e.target.value && onSelectDay(e.target.value)}
              className="bg-transparent outline-none"
              data-testid="trials-date"
            />
          </label>
        </div>
      </div>

      {/* ── The week strip ────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-1 border-b px-2 py-2.5 sm:gap-2 sm:px-4" role="tablist">
        {days.map((d) => {
          const selected = d.date === selectedDay;
          const isDayToday = d.date === today;
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelectDay(d.date)}
              data-testid={`trials-day-${d.date}`}
              className={cn(
                "relative flex min-w-0 flex-col items-center gap-0.5 rounded-xl border px-1 py-2 transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-muted/60 border-transparent",
                !selected && isDayToday && "border-primary/40 bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-medium uppercase sm:text-[11px]",
                  selected ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {weekdayFmt.format(dayAsDate(d.date))}
              </span>
              <span className="text-base font-bold tabular-nums sm:text-lg">
                {dayNumFmt.format(dayAsDate(d.date))}
              </span>
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                  d.total === 0
                    ? "opacity-0"
                    : selected
                      ? "bg-white/25 text-white"
                      : "bg-muted text-foreground",
                )}
              >
                {d.total}
              </span>
              {d.needs_decision > 0 && (
                <span
                  className="absolute end-1.5 top-1.5 size-2 rounded-full bg-rose-600 ring-2 ring-white dark:ring-slate-900"
                  aria-label={t("board.dayNeedsDecision", { count: d.needs_decision })}
                  data-testid="trials-day-red-dot"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Day header + filters ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
        <h3 className="me-auto text-sm font-semibold">
          {isToday ? t("board.todayHeading") : longDayFmt.format(dayAsDate(selectedDay))}
          {isToday && (
            <span className="text-muted-foreground ms-1.5 font-normal">
              {longDayFmt.format(dayAsDate(selectedDay))}
            </span>
          )}
        </h3>
        <div className="no-scrollbar flex overflow-x-auto rounded-lg border p-0.5" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => onFilter(f)}
              data-testid={`trials-filter-${f}`}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {t(`board.filter.${f}`)}
            </button>
          ))}
        </div>
        {teachers.length > 1 && (
          <div className="w-full sm:w-52">
            <Combobox
              options={[
                { value: "", label: t("board.allTeachers") },
                ...teachers.map((tch) => ({ value: tch.id, label: tch.full_name })),
              ]}
              value={teacherId}
              onChange={onTeacher}
              placeholder={t("board.allTeachers")}
              searchPlaceholder={t("add.searchTeacher")}
              data-testid="trials-teacher-filter"
            />
          </div>
        )}
      </div>

      {/* ── The day, as a time rail ───────────────────────────────────── */}
      <div className="p-4 sm:p-5">
        {loading && agenda?.date !== selectedDay ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="bg-muted h-20 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
            <Sparkles className="text-muted-foreground/60 size-6" aria-hidden />
            <p className="text-muted-foreground text-sm">
              {filter !== "all"
                ? t("board.filteredEmpty")
                : isToday
                  ? t("board.emptyToday")
                  : t("board.emptyDay")}
            </p>
          </div>
        ) : (
          <ol className="space-y-3" data-testid="trials-day-list">
            {visible.map((trial, i) => {
              const phase = trialPhase(trial, now);
              return (
                <Fragment key={trial.id}>
                  {i === nowIndex && <NowLine label={t("board.now")} time={timeFmt.format(new Date(now))} />}
                  <li className="flex gap-2.5 sm:gap-4">
                    <div className="w-14 shrink-0 pt-3 text-end sm:w-16">
                      <p
                        className={cn(
                          "text-sm font-bold tabular-nums",
                          phase === "overdue" && "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {timeFmt.format(new Date(trial.scheduled_at_utc))}
                      </p>
                      <p className="text-muted-foreground text-[11px] tabular-nums">
                        {timeFmt.format(new Date(trial.ends_at_utc))}
                      </p>
                    </div>
                    <TrialCard
                      className="min-w-0 flex-1"
                      trial={trial}
                      timezone={timezone}
                      now={now}
                      handlers={handlers}
                      canManage={canManage}
                      busy={busyId === trial.id}
                    />
                  </li>
                </Fragment>
              );
            })}
            {isToday && nowIndex === -1 && (
              <NowLine label={t("board.now")} time={timeFmt.format(new Date(now))} />
            )}
          </ol>
        )}
      </div>
    </section>
  );
}

function NowLine({ label, time }: { label: string; time: string }) {
  return (
    <li className="flex items-center gap-2.5 sm:gap-4" aria-label={`${label} ${time}`} data-testid="trials-now-line">
      <span className="w-14 shrink-0 text-end text-[11px] font-bold tabular-nums text-rose-600 sm:w-16 dark:text-rose-400">
        {time}
      </span>
      <span className="relative h-px flex-1 bg-rose-500/70">
        <span className="absolute -top-1 start-0 size-2 rounded-full bg-rose-500" />
      </span>
    </li>
  );
}
