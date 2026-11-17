"use client";

import { CalendarClock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { academyToday } from "@/lib/academy-clock";
import { cn } from "@/lib/utils";

/** `Y-m-d` + whole days, as a `Y-m-d` — pure calendar arithmetic, no clock involved. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days from `from` to `to` (both `Y-m-d`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type DueState = "overdue" | "today" | "soon" | "later";

/** Where a pay-by date stands against the academy's today. "soon" = within three days. */
export function dueState(dueOn: string, today: string = academyToday()): { state: DueState; days: number } {
  const days = daysBetween(today, dueOn);
  if (days < 0) return { state: "overdue", days: -days };
  if (days === 0) return { state: "today", days: 0 };
  return { state: days <= 3 ? "soon" : "later", days };
}

const TONES: Record<DueState, string> = {
  overdue: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  today: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  soon: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300",
  later: "bg-muted text-muted-foreground",
};

/**
 * A bill's pay-by date as a chip: the date, and — while money is still owed — how it stands
 * ("3 days late", "due today", "in 2 days"). A settled bill shows the plain date.
 */
export function DueDateChip({
  dueOn,
  settled,
  testId,
  inline = false,
}: {
  dueOn: string | null | undefined;
  /** Nothing left to pay: no urgency, just the date. */
  settled?: boolean;
  testId?: string;
  /** One line ("20 Nov · 3 days left") for a label/value row, instead of the two-line chip. */
  inline?: boolean;
}) {
  const t = useTranslations("invoices.due");
  const locale = useLocale();
  if (!dueOn) return <span className="text-muted-foreground text-xs">{t("none")}</span>;

  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${dueOn}T00:00:00Z`),
  );
  const { state, days } = dueState(dueOn);
  const note = settled
    ? null
    : state === "overdue"
      ? t("overdue", { days })
      : state === "today"
        ? t("today")
        : t("inDays", { days });

  if (inline) {
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
          settled ? TONES.later : TONES[state],
        )}
        data-testid={testId}
        data-state={settled ? "settled" : state}
      >
        <span className="truncate">
          {date}
          {note && <span className="font-semibold"> · {note}</span>}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex flex-col items-start gap-0.5 rounded-lg px-2 py-1 text-xs font-medium",
        settled ? TONES.later : TONES[state],
      )}
      data-testid={testId}
      data-state={settled ? "settled" : state}
    >
      <span className="inline-flex items-center gap-1 tabular-nums">
        <CalendarClock className="size-3" aria-hidden />
        {date}
      </span>
      {note && <span className="text-[11px] font-semibold">{note}</span>}
    </span>
  );
}

const PRESETS = [0, 3, 7, 14] as const;

/**
 * The pay-by date as a form field: a date input with one-tap presets (today, in 3 days, a week,
 * two weeks) and a clear. Empty means "no date" — the bill is then chased a day after it was raised.
 */
export function DueDateField({
  value,
  onChange,
  disabled,
  idPrefix = "due",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  idPrefix?: string;
  className?: string;
}) {
  const t = useTranslations("invoices.due");
  const today = academyToday();

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={`${idPrefix}-date`} className="block text-sm font-medium">
        {t("label")} <span className="text-muted-foreground text-xs font-normal">· {t("optional")}</span>
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          id={`${idPrefix}-date`}
          type="date"
          value={value}
          min={today}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="border-input bg-background focus:border-primary focus:ring-primary/15 h-9 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50"
          data-testid={`${idPrefix}-date`}
        />
        {PRESETS.map((days) => {
          const day = addDays(today, days);
          const on = value === day;
          return (
            <button
              key={days}
              type="button"
              disabled={disabled}
              onClick={() => onChange(day)}
              aria-pressed={on}
              data-testid={`${idPrefix}-preset-${days}`}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60 text-muted-foreground",
              )}
            >
              {days === 0 ? t("presetToday") : t("presetDays", { days })}
            </button>
          );
        })}
        {value !== "" && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange("")}
            className="text-muted-foreground hover:text-destructive px-1 text-xs"
            data-testid={`${idPrefix}-clear`}
          >
            {t("clear")}
          </button>
        )}
      </div>
      <p className="text-muted-foreground text-[11px]">{t("hint")}</p>
    </div>
  );
}
