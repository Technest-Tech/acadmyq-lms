"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AvailabilityWindow, CalendarSession } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  bucketByDay,
  minutesIntoDay,
  STATUS_CHIP,
  timeInTz,
  weekdayOf,
} from "./utils";

const PX_PER_HOUR = 56;
/** Where the grid scrolls to on open, so the business day sits near the top (never clipped). */
const SCROLL_TO_HOUR = 7;

/** Lay overlapping sessions into side-by-side lanes within a single day column. */
function packLanes(
  items: CalendarSession[],
  tz: string,
): Array<{ s: CalendarSession; lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) =>
    a.scheduled_at_utc.localeCompare(b.scheduled_at_utc),
  );
  const out: Array<{ s: CalendarSession; lane: number; lanes: number; start: number; end: number }> = [];
  for (const s of sorted) {
    const start = minutesIntoDay(s.scheduled_at_utc, tz);
    const end = start + s.duration_minutes;
    const taken = new Set(
      out.filter((o) => o.start < end && start < o.end).map((o) => o.lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane++;
    out.push({ s, lane, lanes: 1, start, end });
  }
  // Second pass: every event in an overlapping cluster shares the cluster's lane count.
  for (const a of out) {
    const cluster = out.filter((b) => a.start < b.end && b.start < a.end);
    const lanes = Math.max(...cluster.map((c) => c.lane)) + 1;
    for (const c of cluster) c.lanes = Math.max(c.lanes, lanes);
  }
  return out.map(({ s, lane, lanes }) => ({ s, lane, lanes }));
}

/**
 * Google-Calendar-style time grid for the Week and Day views: an hourly gutter on the
 * left, day columns to the right, and each session rendered as a status-coloured block
 * positioned by its start time and sized by its duration (viewer timezone). Overlapping
 * sessions split into lanes; a live red line marks the current time on today's column.
 */
/** "HH:MM" (local wall time) → minutes into the day. */
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Availability bands to paint in a single day column. A window whose end is at or before its
 * start (e.g. 22:00 → 01:00) crosses midnight: its evening portion [start, 24:00) stays on its
 * own weekday while the early-morning tail [00:00, end) spills onto the NEXT weekday's column.
 * An end of "00:00" means midnight (24:00) — the end of the start day, not a wrap.
 */
function availabilityBands(
  windows: AvailabilityWindow[],
  weekday: number,
): Array<{ start: number; end: number; label: string }> {
  const bands: Array<{ start: number; end: number; label: string }> = [];
  for (const w of windows) {
    const s = hhmmToMinutes(w.start_local);
    let e = hhmmToMinutes(w.end_local);
    if (e === 0) e = 24 * 60; // 00:00 end = midnight (end of the start day)
    if (e === s) continue; // zero-length / invalid window
    const label = `${w.start_local}-${w.end_local}`;
    if (e > s) {
      if (w.weekday === weekday) bands.push({ start: s, end: e, label });
    } else {
      if (w.weekday === weekday) bands.push({ start: s, end: 24 * 60, label });
      if ((w.weekday + 1) % 7 === weekday) bands.push({ start: 0, end: e, label });
    }
  }
  return bands;
}

export function TimeGridView({
  days,
  sessions,
  tz,
  today,
  onSelect,
  availability,
}: {
  days: string[];
  sessions: CalendarSession[];
  tz: string;
  today: string;
  onSelect: (s: CalendarSession) => void;
  /** Optional weekly availability windows, drawn as soft background bands per weekday. */
  availability?: AvailabilityWindow[];
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const byDay = useMemo(() => bucketByDay(sessions, tz), [sessions, tz]);

  // Re-render the now-line each minute.
  const [nowMin, setNowMin] = useState(() => minutesIntoDay(new Date().toISOString(), tz));
  useEffect(() => {
    const id = setInterval(
      () => setNowMin(minutesIntoDay(new Date().toISOString(), tz)),
      60_000,
    );
    return () => clearInterval(id);
  }, [tz]);

  // The grid always spans the full 24-hour day (00:00 → 24:00); the user scrolls within it.
  const startHour = 0;
  const endHour = 24;
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const totalMin = 24 * 60;
  const gridHeight = 24 * PX_PER_HOUR;
  const top = (min: number) => (min / totalMin) * gridHeight;

  // On open / navigation, scroll so the earliest session (or 07:00) sits just below the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollHour = useMemo(() => {
    let lo = SCROLL_TO_HOUR;
    for (const s of sessions)
      lo = Math.min(lo, Math.floor(minutesIntoDay(s.scheduled_at_utc, tz) / 60));
    return Math.max(0, lo);
  }, [sessions, tz]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, scrollHour * PX_PER_HOUR - 8);
  }, [scrollHour, days]);

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* Sticky day header */}
      <div
        className="grid border-b"
        style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div className="border-r" />
        {days.map((day) => {
          const isToday = day === today;
          return (
            <div
              key={day}
              data-day={day}
              className={cn(
                "flex flex-col items-center gap-0.5 border-l py-2",
                isToday && "bg-primary/5",
              )}
            >
              <span className="text-muted-foreground text-[0.7rem] font-semibold tracking-wide uppercase">
                {t(`weekday.${weekdayOf(day)}`).slice(0, 3)}
              </span>
              <span
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                  isToday && "bg-primary text-primary-foreground",
                )}
              >
                {Number(day.slice(8, 10))}
              </span>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="max-h-[60vh] overflow-y-auto">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`,
            height: `${gridHeight}px`,
          }}
        >
          {/* Hour gutter */}
          <div className="border-r">
            {hours.map((h) => (
              <div
                key={h}
                className="text-muted-foreground relative text-[0.65rem]"
                style={{ height: `${PX_PER_HOUR}px` }}
              >
                {/* Label sits just below its hour line so the 00:00 row is never clipped. */}
                <span className="absolute top-0.5 end-1.5 tabular-nums whitespace-nowrap">
                  {formatHour(h, locale)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const isToday = day === today;
            const lanes = packLanes(byDay[day] ?? [], tz);
            return (
              <div
                key={day}
                data-day={day}
                className={cn("relative border-l", isToday && "bg-primary/[0.03]")}
              >
                {/* Availability bands (soft emerald) behind the grid lines */}
                {availabilityBands(availability ?? [], weekdayOf(day)).map(
                  (b, i) => (
                    <div
                      key={`av-${i}`}
                      className="pointer-events-none absolute inset-x-0 z-0 bg-emerald-400/10 border-y border-emerald-400/20"
                      style={{ top: `${top(b.start)}px`, height: `${top(b.end) - top(b.start)}px` }}
                      data-availability={b.label}
                    />
                  ),
                )}

                {/* Hour lines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-border/60 border-t"
                    style={{ height: `${PX_PER_HOUR}px` }}
                  />
                ))}

                {/* Now indicator */}
                {isToday && nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20"
                    style={{ top: `${top(nowMin)}px` }}
                    data-testid="now-indicator"
                  >
                    <div className="relative">
                      <div className="absolute -top-1 -left-1 size-2 rounded-full bg-red-500" />
                      <div className="border-t border-red-500" />
                    </div>
                  </div>
                )}

                {/* Session blocks */}
                {lanes.map(({ s, lane, lanes: n }) => {
                  const start = minutesIntoDay(s.scheduled_at_utc, tz);
                  const height = Math.max((s.duration_minutes / totalMin) * gridHeight, 22);
                  const width = 100 / n;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      data-testid={`session-${s.id}`}
                      data-status={s.status}
                      onClick={() => onSelect(s)}
                      className={cn(
                        "absolute z-10 overflow-hidden rounded-lg border px-1.5 py-1 text-start text-[0.7rem] shadow-sm transition-all hover:z-30 hover:shadow-md",
                        STATUS_CHIP[s.status],
                      )}
                      style={{
                        top: `${top(start)}px`,
                        height: `${height}px`,
                        insetInlineStart: `calc(${lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                    >
                      <span className="block truncate font-semibold tabular-nums">
                        {timeInTz(s.scheduled_at_utc, tz, locale)}
                      </span>
                      <span className="block truncate font-medium">
                        {s.student_name ?? ""}
                      </span>
                      {height > 44 && (
                        <span className="block truncate opacity-70">
                          {t(`status.${s.status}`)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatHour(h: number, locale: string): string {
  // Render a bare hour ("9 AM", "14:00") from a fixed UTC instant read back in UTC, so the
  // label is exactly `h` regardless of the viewer's browser timezone.
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, 0, 1, h, 0)));
}
