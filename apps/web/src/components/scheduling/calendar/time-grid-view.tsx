"use client";

import { CalendarX2, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvailabilityWindow, CalendarSession } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  bucketByDay,
  endUtc,
  hourWindow,
  isVoided,
  minutesIntoDay,
  STATUS_CHIP,
  STATUS_RAIL,
  timeInTz,
  weekdayOf,
} from "./utils";

/** Row height for the Week grid, and the taller scale the single-column Day view can afford. */
const PX_PER_HOUR_WEEK = 64;
const PX_PER_HOUR_DAY = 92;
/** Drag/drop and quick-create both snap to this granularity (minutes). */
const SNAP_MIN = 15;
/** Default length for a quick-created session. */
const DEFAULT_NEW_DURATION = 30;
/** Pointer travel (px) before a press is treated as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/**
 * Height thresholds that decide how much a block can say without clipping. Measured against the
 * real line-heights below: a block only shows a line if it can render it whole.
 *   • < COMPACT  → one line, time and name side by side
 *   • < REGULAR  → time line + name line
 *   • ≥ REGULAR  → time range, name, and the teacher/status footer
 */
const H_COMPACT = 38;
const H_REGULAR = 62;

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** A session is movable only while it is a live SCHEDULED occurrence. */
function isDraggable(s: CalendarSession): boolean {
  return s.status === "SCHEDULED";
}

type DragState = {
  s: CalendarSession;
  originDay: string;
  originMin: number;
  /** Pointer's distance below the block's top edge, in minutes (keeps the grab point steady). */
  offsetMin: number;
  startX: number;
  startY: number;
  curDay: string;
  curMin: number;
  moved: boolean;
};

type Placed = { s: CalendarSession; lane: number; lanes: number };

/**
 * Lay overlapping sessions into side-by-side lanes within a single day column. Two sessions
 * share a lane only if they don't overlap in time; everything in one overlapping cluster is
 * given the same lane count, so a cluster of three splits the column into equal thirds.
 */
function packLanes(items: CalendarSession[], tz: string): Placed[] {
  const sorted = [...items].sort((a, b) =>
    a.scheduled_at_utc.localeCompare(b.scheduled_at_utc),
  );
  const out: Array<Placed & { start: number; end: number }> = [];
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
      if ((w.weekday + 1) % 7 === weekday)
        bands.push({ start: 0, end: e, label });
    }
  }
  return bands;
}

/** "minutes into day" → "HH:MM" wall-clock label. */
function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The Week and Day views: an hour gutter on the left, day columns to the right, and each session
 * drawn as a status-coloured block positioned by its start time and sized by its duration in the
 * viewer's timezone.
 *
 * The grid paints only the hours the day actually uses (see `hourWindow`) rather than a full
 * 24 hours, which is what buys each block enough height to render its text — a 30-minute lesson
 * gets 32px at the week scale and 46px at the day scale. Blocks then shed detail as they shrink,
 * so nothing is ever clipped mid-line. Overlapping sessions split into lanes; a live red line
 * marks the current time on today's column.
 */
export function TimeGridView({
  days,
  sessions,
  tz,
  today,
  onSelect,
  onReschedule,
  onCreateAt,
  canDrag = false,
  canCreate = false,
  availability,
}: {
  days: string[];
  sessions: CalendarSession[];
  tz: string;
  today: string;
  onSelect: (s: CalendarSession) => void;
  /** Drop a SCHEDULED session at a new day + start-minute (drag-to-reschedule). */
  onReschedule?: (s: CalendarSession, day: string, startMin: number) => void;
  /** Click an empty slot to create a one-off session at that day + start-minute. */
  onCreateAt?: (day: string, startMin: number) => void;
  /** Enable drag-to-reschedule for SCHEDULED sessions (Owner only). */
  canDrag?: boolean;
  /** Enable click-empty-slot quick-create (Owner only). */
  canCreate?: boolean;
  /** Optional weekly availability windows, drawn as soft background bands per weekday. */
  availability?: AvailabilityWindow[];
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const byDay = useMemo(() => bucketByDay(sessions, tz), [sessions, tz]);
  const isDayView = days.length === 1;

  // Re-render the now-line each minute.
  const [nowMin, setNowMin] = useState(() =>
    minutesIntoDay(new Date().toISOString(), tz),
  );
  useEffect(() => {
    const id = setInterval(
      () => setNowMin(minutesIntoDay(new Date().toISOString(), tz)),
      60_000,
    );
    return () => clearInterval(id);
  }, [tz]);

  // The grid shows the working day by default and expands to the full 24 hours on request.
  const [fullDay, setFullDay] = useState(false);
  const { startHour, endHour } = useMemo(
    () => hourWindow(sessions, tz, fullDay),
    [sessions, tz, fullDay],
  );

  const pxPerHour = isDayView ? PX_PER_HOUR_DAY : PX_PER_HOUR_WEEK;
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  );
  const originMin = startHour * 60;
  const spanMin = (endHour - startHour) * 60;
  const gridHeight = (endHour - startHour) * pxPerHour;
  /** Minutes-into-day → px from the top of the painted window. */
  const top = useCallback(
    (min: number) => ((min - originMin) / spanMin) * gridHeight,
    [originMin, spanMin, gridHeight],
  );

  // ── Drag-to-reschedule ─────────────────────────────────────────────────────
  // The inner grid (whose rect maps clientY → minutes) and per-day columns (hit-tested by
  // clientX so RTL just works). A single ref mirrors the drag for the window listeners.
  const gridRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Swallows the synthetic click that follows a real drag (it would otherwise open the modal
  // or fire quick-create wherever the pointer was released).
  const suppressClick = useRef(false);

  const setDragState = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const minuteAt = useCallback(
    (clientY: number) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return originMin;
      return originMin + ((clientY - rect.top) / gridHeight) * spanMin;
    },
    [gridHeight, spanMin, originMin],
  );

  const dayAt = useCallback((clientX: number, fallback: string) => {
    for (const [day, el] of Object.entries(colRefs.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return day;
    }
    return fallback;
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved =
        d.moved ||
        Math.abs(e.clientX - d.startX) > DRAG_THRESHOLD ||
        Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD;
      const curDay = dayAt(e.clientX, d.curDay);
      const raw = minuteAt(e.clientY) - d.offsetMin;
      // A drop is clamped to the painted window, not to the whole day — you cannot drag a
      // session into an hour the grid isn't showing.
      const curMin = clamp(
        snap(raw),
        originMin,
        originMin + spanMin - d.s.duration_minutes,
      );
      setDragState({ ...d, curDay, curMin, moved });
    };
    const onUp = () => {
      const d = dragRef.current;
      setDragState(null);
      if (!d) return;
      if (d.moved) {
        suppressClick.current = true;
        if (d.curDay !== d.originDay || d.curMin !== d.originMin) {
          onReschedule?.(d.s, d.curDay, d.curMin);
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [
    drag,
    dayAt,
    minuteAt,
    onReschedule,
    setDragState,
    originMin,
    spanMin,
  ]);

  const beginDrag = useCallback(
    (e: React.PointerEvent, s: CalendarSession, day: string) => {
      if (!canDrag || !isDraggable(s) || e.button !== 0) return;
      const startMin = minutesIntoDay(s.scheduled_at_utc, tz);
      setDragState({
        s,
        originDay: day,
        originMin: startMin,
        offsetMin: minuteAt(e.clientY) - startMin,
        startX: e.clientX,
        startY: e.clientY,
        curDay: day,
        curMin: startMin,
        moved: false,
      });
    },
    [canDrag, tz, minuteAt, setDragState],
  );

  const handleSelect = useCallback(
    (s: CalendarSession) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onSelect(s);
    },
    [onSelect],
  );

  const handleCreate = useCallback(
    (e: React.MouseEvent, day: string) => {
      if (!canCreate || !onCreateAt) return;
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const raw = originMin + ((e.clientY - rect.top) / gridHeight) * spanMin;
      const min = clamp(
        snap(raw),
        originMin,
        originMin + spanMin - DEFAULT_NEW_DURATION,
      );
      onCreateAt(day, min);
    },
    [canCreate, onCreateAt, gridHeight, spanMin, originMin],
  );

  // Open on the first session of the range (or the top of the window) rather than at 00:00.
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstHour = useMemo(() => {
    let lo = Infinity;
    for (const s of sessions)
      lo = Math.min(lo, Math.floor(minutesIntoDay(s.scheduled_at_utc, tz) / 60));
    return Number.isFinite(lo) ? lo : startHour;
  }, [sessions, tz, startHour]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (firstHour - startHour) * pxPerHour - 12);
  }, [firstHour, startHour, pxPerHour, days]);

  const nowVisible = nowMin >= originMin && nowMin <= originMin + spanMin;

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* Sticky day header */}
      <div
        className="bg-card/95 sticky top-0 z-40 grid border-b backdrop-blur"
        style={{
          gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {/* The gutter corner doubles as the working-day / full-day toggle. */}
        <button
          type="button"
          data-testid="toggle-full-day"
          onClick={() => setFullDay((v) => !v)}
          aria-pressed={fullDay}
          title={fullDay ? t("calendar.workingHours") : t("calendar.fullDay")}
          aria-label={fullDay ? t("calendar.workingHours") : t("calendar.fullDay")}
          className="text-muted-foreground hover:text-foreground hover:bg-muted/60 flex items-center justify-center border-e transition-colors"
        >
          {fullDay ? (
            <ChevronsDownUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronsUpDown className="size-3.5" aria-hidden />
          )}
        </button>

        {days.map((day) => {
          const isToday = day === today;
          const count = (byDay[day] ?? []).length;
          return (
            <div
              key={day}
              data-day={day}
              className={cn(
                "flex flex-col items-center gap-0.5 border-s py-2.5",
                isToday && "bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "text-[0.7rem] font-semibold tracking-wide uppercase",
                  isToday ? "text-primary" : "text-muted-foreground",
                )}
              >
                {t(`weekday.${weekdayOf(day)}`).slice(0, 3)}
              </span>
              <span
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-sm font-bold tabular-nums transition-colors",
                  isToday && "bg-primary text-primary-foreground shadow-sm",
                )}
              >
                {Number(day.slice(8, 10))}
              </span>
              {/* Per-day load, so a week reads at a glance without counting blocks. */}
              <span
                className={cn(
                  "text-[0.65rem] font-medium tabular-nums",
                  count > 0 ? "text-muted-foreground" : "text-transparent",
                )}
              >
                {t("calendar.sessionCount", { count })}
              </span>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="relative max-h-[62vh] overflow-y-auto">
        {sessions.length === 0 && (
          // An overlay rather than a replacement: the empty grid stays clickable so an owner can
          // still drop a session into an empty week.
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 text-center">
            <div className="bg-card/90 flex flex-col items-center gap-1.5 rounded-2xl border px-6 py-5 shadow-sm backdrop-blur">
              <CalendarX2 className="text-muted-foreground/60 size-7" aria-hidden />
              <p className="text-muted-foreground text-sm font-medium">
                {t("calendar.noSessions")}
              </p>
              {canCreate && (
                <p className="text-muted-foreground/70 text-xs">
                  {t("calendar.emptyGridHint")}
                </p>
              )}
            </div>
          </div>
        )}

        <div
          ref={gridRef}
          className="relative grid"
          style={{
            gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))`,
            height: `${gridHeight}px`,
          }}
        >
          {/* Hour gutter */}
          <div className="border-e">
            {hours.map((h) => (
              <div
                key={h}
                className="text-muted-foreground relative text-[0.65rem] font-medium"
                style={{ height: `${pxPerHour}px` }}
              >
                {/* The label straddles its own hour line, except the first — which would be
                    clipped by the top edge, so it sits just below it. */}
                <span
                  className={cn(
                    "absolute end-2 tabular-nums whitespace-nowrap",
                    h === startHour ? "top-1" : "-top-1.5",
                  )}
                >
                  {formatHour(h, locale)}
                </span>
              </div>
            ))}
          </div>

          {/* The now-line's time bubble, pinned in the gutter across all columns. */}
          {nowVisible && days.includes(today) && (
            <div
              className="pointer-events-none absolute z-30 -translate-y-1/2 ps-1"
              style={{ top: `${top(nowMin)}px`, insetInlineStart: 0 }}
            >
              <span className="rounded-md bg-red-500 px-1.5 py-0.5 text-[0.6rem] font-bold text-white tabular-nums shadow-sm">
                {minutesToHHMM(nowMin)}
              </span>
            </div>
          )}

          {/* Day columns */}
          {days.map((day) => {
            const isToday = day === today;
            const lanes = packLanes(byDay[day] ?? [], tz);
            const showGhost = drag?.moved && drag.curDay === day;
            return (
              <div
                key={day}
                ref={(el) => {
                  colRefs.current[day] = el;
                }}
                data-day={day}
                onClick={(e) => handleCreate(e, day)}
                className={cn(
                  "group/col relative border-s",
                  isToday && "bg-primary/[0.03]",
                  canCreate && "cursor-copy",
                )}
              >
                {/* Availability bands (soft emerald) behind the grid lines */}
                {availabilityBands(availability ?? [], weekdayOf(day)).map(
                  (b, i) => (
                    <div
                      key={`av-${i}`}
                      className="pointer-events-none absolute inset-x-0 z-0 border-y border-emerald-400/25 bg-emerald-400/[0.08]"
                      style={{
                        top: `${top(b.start)}px`,
                        height: `${top(b.end) - top(b.start)}px`,
                      }}
                      data-availability={b.label}
                    />
                  ),
                )}

                {/* Hour lines — the half-hour is a hairline, so 30-minute blocks read against it */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-border/70 border-t"
                    style={{ height: `${pxPerHour}px` }}
                  >
                    <div className="border-border/30 h-1/2 border-b" />
                  </div>
                ))}

                {/* Now indicator */}
                {isToday && nowVisible && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20"
                    style={{ top: `${top(nowMin)}px` }}
                    data-testid="now-indicator"
                  >
                    <div className="relative">
                      <div className="absolute -top-[3px] size-1.5 rounded-full bg-red-500 shadow-[0_0_0_2px] shadow-red-500/20 ltr:-left-[3px] rtl:-right-[3px]" />
                      <div className="border-t border-red-500" />
                    </div>
                  </div>
                )}

                {/* Drag preview — where the session will land on drop */}
                {showGhost && drag && (
                  <div
                    className="border-primary bg-primary/10 pointer-events-none absolute inset-x-1 z-40 rounded-lg border-2 border-dashed"
                    style={{
                      top: `${top(drag.curMin)}px`,
                      height: `${Math.max(
                        (drag.s.duration_minutes / spanMin) * gridHeight,
                        24,
                      )}px`,
                    }}
                    data-testid="drag-ghost"
                  >
                    <span className="text-primary block px-1.5 py-1 text-[0.7rem] font-bold tabular-nums">
                      {minutesToHHMM(drag.curMin)}
                    </span>
                  </div>
                )}

                {/* Session blocks */}
                {lanes.map(({ s, lane, lanes: n }) => (
                  <EventBlock
                    key={s.id}
                    s={s}
                    lane={lane}
                    lanes={n}
                    tz={tz}
                    locale={locale}
                    t={t}
                    top={top}
                    spanMin={spanMin}
                    gridHeight={gridHeight}
                    originMin={originMin}
                    draggable={canDrag && isDraggable(s)}
                    dragging={drag?.s.id === s.id && drag.moved}
                    onPointerDown={(e) => beginDrag(e, s, day)}
                    onSelect={() => handleSelect(s)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * One session, drawn to scale. The block is clipped to the painted window (a lesson that starts
 * before the first visible hour still shows its tail) and never rendered shorter than a legible
 * minimum — which is why a 15-minute lesson stays readable even though its true height would be
 * 16px. Content is then chosen to fit the height it actually got, so no line is ever half-cut.
 */
function EventBlock({
  s,
  lane,
  lanes,
  tz,
  locale,
  t,
  top,
  spanMin,
  gridHeight,
  originMin,
  draggable,
  dragging,
  onPointerDown,
  onSelect,
}: {
  s: CalendarSession;
  lane: number;
  lanes: number;
  tz: string;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  top: (min: number) => number;
  spanMin: number;
  gridHeight: number;
  originMin: number;
  draggable: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onSelect: () => void;
}) {
  const rawStart = minutesIntoDay(s.scheduled_at_utc, tz);
  // Clip to the window: a session starting before the first painted hour is drawn from the top
  // edge, and one running past the last is cut at the bottom — never drawn outside the grid.
  const start = Math.max(rawStart, originMin);
  const rawEnd = Math.min(rawStart + s.duration_minutes, originMin + spanMin);
  const visibleMin = Math.max(rawEnd - start, 0);
  if (visibleMin <= 0) return null;

  const MIN_H = 26;
  const height = Math.max((visibleMin / spanMin) * gridHeight, MIN_H);

  // Overlapping sessions share the column, but each block overlaps its neighbour slightly and
  // later lanes sit above earlier ones — so a narrow lane still shows its student's name, the
  // way Google Calendar cascades a busy hour.
  const width = lanes === 1 ? 100 : (100 / lanes) * 1.35;
  const offset = lane * (100 / lanes);

  const voided = isVoided(s.status);
  const tier = height < H_COMPACT ? "compact" : height < H_REGULAR ? "regular" : "full";
  const startLabel = timeInTz(s.scheduled_at_utc, tz, locale);
  const endLabel = timeInTz(endUtc(s), tz, locale);
  const name = s.student_name ?? t("calendar.unnamedStudent");

  return (
    <button
      type="button"
      data-testid={`session-${s.id}`}
      data-status={s.status}
      onPointerDown={draggable ? onPointerDown : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`${startLabel} – ${endLabel} · ${name}${
        s.teacher_name ? ` · ${s.teacher_name}` : ""
      } · ${t(`status.${s.status}`)}`}
      className={cn(
        "group/ev absolute z-10 flex flex-col overflow-hidden rounded-lg border text-start shadow-sm transition-[box-shadow,transform] hover:z-30 hover:shadow-md focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
        STATUS_CHIP[s.status],
        voided && "opacity-70",
        draggable && "cursor-grab touch-none active:cursor-grabbing",
        dragging && "opacity-40",
      )}
      style={{
        top: `${top(start)}px`,
        height: `${height}px`,
        insetInlineStart: `calc(${offset}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        zIndex: 10 + lane,
      }}
    >
      {/* The status rail — the one cue that survives at any height. */}
      <span
        className={cn(
          "absolute inset-y-0 w-1 opacity-90 ltr:left-0 rtl:right-0",
          STATUS_RAIL[s.status],
        )}
        aria-hidden
      />

      <span className="flex min-h-0 flex-1 flex-col justify-start gap-0.5 py-1 pe-1.5 ps-2.5">
        {tier === "compact" ? (
          // One line only: the name leads (it's what you scan for), the start time trails.
          <span className="flex items-baseline gap-1.5 overflow-hidden">
            <span
              className={cn(
                "truncate text-[0.7rem] leading-tight font-semibold",
                voided && "line-through",
              )}
            >
              {name}
            </span>
            <span className="ms-auto shrink-0 text-[0.65rem] leading-tight font-medium tabular-nums opacity-80">
              {startLabel}
            </span>
          </span>
        ) : (
          <>
            <span className="truncate text-[0.68rem] leading-tight font-bold tabular-nums opacity-90">
              {tier === "full" ? `${startLabel} – ${endLabel}` : startLabel}
            </span>
            <span
              className={cn(
                "truncate text-[0.75rem] leading-tight font-semibold",
                voided && "line-through",
              )}
            >
              {name}
            </span>
            {tier === "full" && (
              <span className="mt-auto flex items-center gap-1.5 overflow-hidden pt-0.5">
                <span className="truncate text-[0.65rem] leading-tight font-medium opacity-75">
                  {t(`status.${s.status}`)}
                </span>
                {s.teacher_name && (
                  <span className="truncate text-[0.65rem] leading-tight opacity-60">
                    · {s.teacher_name}
                  </span>
                )}
              </span>
            )}
          </>
        )}
      </span>
    </button>
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
