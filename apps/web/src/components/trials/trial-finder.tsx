"use client";

import {
  AlertTriangle,
  CalendarDays,
  CalendarX2,
  Check,
  ChevronDown,
  Clock,
  Hourglass,
  Loader2,
  RotateCcw,
  UserCog,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  getAvailabilityGrid,
  type TrialAvailabilityGrid,
  type TrialAvailabilityTeacher,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHm12 } from "@/lib/time";
import { cn } from "@/lib/utils";

const DURATIONS = [30, 45, 60, 90, 120];

export interface TrialSlot {
  date: string;
  time: string;
  duration: number;
  timezone: string;
}

/** Local YYYY-MM-DD (avoids the UTC shift of toISOString). */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** The Sunday 00:00 of the week containing d. */
function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

/**
 * The availability calendar. A premium filter bar (date · time · duration) drives a week grid of
 * bookable slots; each cell shows how many teachers are free at that slot — conflict-aware — and
 * selecting one (via the pickers or by clicking) lists those teachers in a side panel to book from.
 */
export function TrialFinder({
  onBook,
}: {
  onBook: (teacher: TrialAvailabilityTeacher, slot: TrialSlot) => void;
}) {
  const t = useTranslations("trials");
  const locale = useLocale();

  const todayStr = localDateStr(new Date());
  const nowHm = new Date().toTimeString().slice(0, 5);

  const [date, setDate] = useState(todayStr);
  const [time, setTime] = useState<string>("");
  const [duration, setDuration] = useState(30);
  const dateRef = useRef<HTMLInputElement>(null);

  /** Open the native date picker from anywhere on the field (not just its indicator). */
  function openDatePicker() {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  function reset() {
    setDate(todayStr);
    setTime("");
    setDuration(30);
  }

  const isDirty = date !== todayStr || time !== "" || duration !== 30;

  const [grid, setGrid] = useState<TrialAvailabilityGrid | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The week the grid renders is the one containing the picked date.
  const weekStartStr = useMemo(
    () => localDateStr(startOfWeek(new Date(`${date}T00:00:00`))),
    [date],
  );

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(null);
    getAvailabilityGrid({ week_start: weekStartStr, duration_minutes: duration })
      .then((g) => alive && setGrid(g))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [weekStartStr, duration]);

  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date(`${date}T00:00:00`)),
    [date, locale],
  );

  const timeOptions = useMemo(
    () => (grid?.times ?? []).map((tm) => ({ value: tm, label: formatHm12(tm, locale) })),
    [grid, locale],
  );

  const selected = time ? { date, time } : null;
  const selectedTeachers: TrialAvailabilityTeacher[] = selected
    ? (grid?.cells[`${selected.date}T${selected.time}`] ?? [])
    : [];

  function isPast(d: string, tm: string): boolean {
    return d < todayStr || (d === todayStr && tm < nowHm);
  }

  return (
    <div className="space-y-4">
      {/* ── Premium filter bar ────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-2xl border bg-gradient-to-br from-card to-muted/30 p-2 shadow-sm sm:flex-row sm:items-stretch">
        {/* Date — the whole field opens the picker */}
        <FilterField
          icon={CalendarDays}
          label={t("finder.dateLabel")}
          tone="primary"
          onClick={openDatePicker}
        >
          <span className="text-sm font-semibold">{dateLabel}</span>
          <input
            ref={dateRef}
            type="date"
            value={date}
            min={todayStr}
            onChange={(e) => {
              if (e.target.value) {
                setDate(e.target.value);
                setTime("");
              }
            }}
            aria-label={t("finder.dateLabel")}
            data-testid="finder-date"
            tabIndex={-1}
            className="sr-only"
          />
        </FilterField>

        {/* Time */}
        <FilterField icon={Clock} label={t("finder.timeLabel")} tone="violet">
          <TimeSelect
            options={timeOptions}
            value={time}
            onChange={setTime}
            placeholder={t("finder.anyTime")}
          />
        </FilterField>

        {/* Duration — segmented */}
        <FilterField icon={Hourglass} label={t("finder.duration")} tone="amber">
          <div className="flex items-center gap-0.5">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                data-testid={`finder-duration-${d}`}
                className={cn(
                  "rounded-lg px-2 py-1 text-xs font-semibold tabular-nums transition-colors",
                  duration === d
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </FilterField>

        <div className="flex items-center justify-end gap-2 ps-1 sm:ms-auto">
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={!isDirty}
            className="gap-1.5"
            data-testid="finder-reset"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t("finder.reset")}
          </Button>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* ── Calendar grid ───────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {grid && grid.times.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center">
              <CalendarX2 className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{t("finder.noAvailabilityTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("finder.noAvailabilityHint")}</p>
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="border-b border-e bg-muted/30 p-2 text-xs font-semibold text-muted-foreground" />
                    {(grid?.days ?? []).map((d) => {
                      const dt = new Date(`${d.date}T00:00:00`);
                      const isToday = d.date === todayStr;
                      const isPicked = d.date === date;
                      return (
                        <th
                          key={d.date}
                          className={cn(
                            "border-b border-e bg-muted/30 px-2 py-2 text-center font-medium last:border-e-0",
                            isPicked && "bg-primary/10",
                          )}
                        >
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {dayFmt.format(dt)}
                          </div>
                          <div
                            className={cn(
                              "text-sm font-bold tabular-nums",
                              (isToday || isPicked) && "text-primary",
                            )}
                          >
                            {dt.getDate()}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(grid?.times ?? []).map((tm) => (
                    <tr key={tm}>
                      <td
                        className={cn(
                          "border-b border-e bg-muted/20 whitespace-nowrap px-2 py-1.5 text-center text-[11px] font-medium tabular-nums text-muted-foreground",
                          tm === time && "bg-primary/10 text-primary",
                        )}
                      >
                        {formatHm12(tm, locale)}
                      </td>
                      {(grid?.days ?? []).map((d) => {
                        const key = `${d.date}T${tm}`;
                        const teachers = grid?.cells[key];
                        const past = isPast(d.date, tm);
                        const free = teachers?.filter((x) => !x.has_conflict).length ?? 0;
                        const conflicted = (teachers?.length ?? 0) - free;
                        const isSelected = selected?.date === d.date && selected?.time === tm;
                        const hasAny = (teachers?.length ?? 0) > 0;
                        const tip = (teachers ?? [])
                          .map((x) =>
                            x.has_conflict ? `${x.full_name} — ${t("finder.busy")}` : x.full_name,
                          )
                          .join("\n");
                        return (
                          <td key={key} className="border-b border-e p-0.5 last:border-e-0">
                            {hasAny ? (
                              <button
                                type="button"
                                disabled={past}
                                onClick={() => {
                                  setDate(d.date);
                                  setTime(tm);
                                }}
                                data-testid="finder-cell"
                                className={cn(
                                  "flex h-8 w-full items-center justify-center gap-1 rounded-md px-1 text-[11px] font-semibold transition-colors",
                                  past && "cursor-not-allowed opacity-40",
                                  isSelected && "ring-2 ring-primary",
                                  free > 0
                                    ? "bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                                    : "bg-amber-500/12 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
                                )}
                                title={`${t("finder.slotHeading", {
                                  date: d.date,
                                  time: formatHm12(tm, locale),
                                })}\n${tip}`}
                              >
                                <Users className="size-3 shrink-0 opacity-70" aria-hidden />
                                <span className="truncate">
                                  {free > 0
                                    ? t("finder.cellFree", { count: free })
                                    : t("finder.cellBusy", { count: conflicted })}
                                </span>
                                {free > 0 && conflicted > 0 && (
                                  <span
                                    className="size-1 shrink-0 rounded-full bg-amber-500"
                                    aria-hidden
                                  />
                                )}
                              </button>
                            ) : (
                              <div
                                className="flex h-8 items-center justify-center rounded-md bg-muted/40"
                                title={t("finder.cellNone")}
                                aria-label={t("finder.cellNone")}
                              >
                                <span className="text-[11px] text-muted-foreground/40">
                                  {t("finder.cellNoneShort")}
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Legend — what the coloured blocks mean. */}
          {grid && grid.times.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-3 py-2.5 text-[11px] text-muted-foreground">
              <LegendItem
                className="bg-emerald-500/40 ring-emerald-500/30"
                label={t("finder.legendAvailable")}
              />
              <LegendItem
                className="bg-amber-500/40 ring-amber-500/30"
                label={t("finder.legendBooked")}
              />
              <LegendItem className="bg-muted ring-border" label={t("finder.legendNone")} />
            </div>
          )}
        </div>

        {/* ── Detail panel ────────────────────────────────────────────── */}
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          {!selected ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
              <Clock className="size-6 text-muted-foreground/60" aria-hidden />
              <p className="text-sm font-medium">{t("finder.pickSlotTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("finder.pickSlotHint")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold">
                  {t("finder.slotHeading", {
                    date: selected.date,
                    time: formatHm12(selected.time, locale),
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("finder.resultCount", { count: selectedTeachers.length })}
                </p>
              </div>
              {selectedTeachers.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                  {t("finder.noneAtSlot")}
                </div>
              ) : (
                <div className="space-y-2">
                  {[...selectedTeachers]
                    .sort((a, b) => Number(a.has_conflict) - Number(b.has_conflict))
                    .map((teacher) => (
                      <div
                        key={teacher.id}
                        className="rounded-xl border p-3"
                        data-testid="finder-teacher"
                        data-teacher={teacher.id}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                            <UserCog className="size-4" aria-hidden />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{teacher.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {teacher.specialization ?? "—"} ·{" "}
                              {formatMoney(
                                { amount: teacher.session_rate_minor, currency: teacher.currency },
                                locale,
                              )}
                            </p>
                          </div>
                        </div>
                        {teacher.has_conflict && (
                          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="size-3" aria-hidden />
                            {t("finder.conflict")}
                          </p>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant={teacher.has_conflict ? "outline" : "default"}
                          onClick={() =>
                            onBook(teacher, {
                              date: selected.date,
                              time: selected.time,
                              duration,
                              timezone: grid?.timezone ?? "",
                            })
                          }
                          className="mt-2 w-full gap-1.5"
                          data-testid="finder-book"
                        >
                          <Clock className="size-3.5" aria-hidden />
                          {t("finder.book")}
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-3 rounded-[4px] ring-1", className)} aria-hidden />
      {label}
    </span>
  );
}

// ── Premium filter field ───────────────────────────────────────────────────────

const TONES = {
  primary: "bg-primary/10 text-primary ring-primary/20",
  violet: "bg-violet-500/10 text-violet-600 ring-violet-500/20 dark:text-violet-400",
  amber: "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400",
} as const;

function FilterField({
  icon: Icon,
  label,
  tone,
  children,
  onClick,
}: {
  icon: typeof Clock;
  label: string;
  tone: keyof typeof TONES;
  children: React.ReactNode;
  /** When set, the whole field is clickable (e.g. to open the date picker). */
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2 shadow-sm",
        onClick &&
          "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none",
      )}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
          TONES[tone],
        )}
      >
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

// ── Inline time dropdown (matches the filter-field chrome, no extra border) ─────

function TimeSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="finder-time"
        className="flex items-center gap-1 text-sm font-semibold outline-none"
      >
        <span className={cn(!selected && "font-medium text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          className="bg-popover absolute z-30 mt-1.5 max-h-60 w-36 overflow-auto rounded-xl border p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-start text-sm transition-colors hover:bg-muted",
              !value && "text-primary",
            )}
          >
            {placeholder}
            {!value && <Check className="size-3.5" aria-hidden />}
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-start text-sm tabular-nums transition-colors hover:bg-muted",
                o.value === value && "bg-primary/8 text-primary",
              )}
            >
              {o.label}
              {o.value === value && <Check className="size-3.5 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
