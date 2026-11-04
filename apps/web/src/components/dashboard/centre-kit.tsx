"use client";

import { ArrowRight, ArrowDown, ArrowUp, ChevronDown, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CountUp } from "@/components/dashboard/academy-dashboard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatNumber } from "@/lib/money";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";

/**
 * The learning centre's dashboard pieces: a white card, a pastel icon tile, one big number. Kept apart
 * from academy-dashboard.tsx so that screen stays exactly what it is.
 */
export type CentreTone = "violet" | "indigo" | "sky" | "emerald" | "amber" | "rose" | "slate" | "pink";

const TONES: Record<CentreTone, string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  pink: "bg-pink-100 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
};

export const centrePanelClass = "centre-surface bg-card rounded-[1.125rem] border";

/** "↑ +12%": green up, red down, grey level. Null is no chip at all: nothing to compare with. */
export function DeltaChip({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const Arrow = value > 0 ? ArrowUp : value < 0 ? ArrowDown : null;
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
        value > 0 && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
        value < 0 && "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
        value === 0 && "bg-muted text-muted-foreground",
      )}
    >
      {Arrow && <Arrow className="size-3" aria-hidden />}
      {value > 0 ? "+" : ""}
      {value}%
    </span>
  );
}

export function KpiCard({
  Icon,
  tone,
  label,
  value,
  chip,
  note,
  loading,
  href,
  locale,
}: {
  Icon: LucideIcon;
  tone: CentreTone;
  label: string;
  /** null ⇒ "—": the figure could not be read, which is not the same as zero. */
  value: number | null;
  chip?: ReactNode;
  note?: string;
  loading: boolean;
  href?: string;
  locale: string;
}) {
  const inner = (
    <div className={cn(centrePanelClass, "flex h-full flex-col p-3.5 transition-shadow sm:p-5", href && "hover:shadow-md")}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-foreground/85 text-[0.8125rem] leading-snug font-bold sm:text-base">{label}</p>
          {loading ? (
            <div className="bg-muted mt-2 h-9 w-20 animate-pulse rounded-lg" />
          ) : (
            <p className="mt-1 text-[1.625rem] leading-tight font-extrabold tracking-tight tabular-nums sm:text-[2rem]">
              {value === null ? "—" : <CountUp value={value} locale={locale} />}
            </p>
          )}
        </div>
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-14 sm:rounded-2xl", TONES[tone])}>
          <Icon className="size-5 sm:size-6" aria-hidden />
        </span>
      </div>
      {!loading && (chip || note) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-3">
          {note && <span className="text-muted-foreground hidden text-xs sm:inline">{note}</span>}
          {chip}
        </div>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full" data-testid="kpi-card">
      {inner}
    </Link>
  ) : (
    <div data-testid="kpi-card">{inner}</div>
  );
}

/** A card's title row: the small icon and the bold title, an optional control at the end. */
export function PanelTitle({ Icon, title, end }: { Icon: LucideIcon; title: string; end?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="text-primary size-5 shrink-0" aria-hidden />
        <h2 className="truncate text-base font-extrabold sm:text-lg">{title}</h2>
      </div>
      {end}
    </div>
  );
}

/** A list card: title, rows, and one full-width button to the screen that owns them. */
export function ListCard({
  Icon,
  title,
  footerHref,
  footerLabel,
  empty,
  testId,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  footerHref?: string;
  footerLabel?: string;
  /** Shown instead of the rows when there are none. */
  empty?: string;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn(centrePanelClass, "flex flex-col p-4 sm:p-5")} data-testid={testId}>
      <PanelTitle Icon={Icon} title={title} />
      <div className="mt-3 flex-1 space-y-1">
        {empty ? <p className="text-muted-foreground py-8 text-center text-sm">{empty}</p> : children}
      </div>
      {footerHref && footerLabel && (
        <Link
          href={footerHref}
          className="border-border hover:bg-muted focus-visible:ring-ring/50 mt-3 flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-colors outline-none focus-visible:ring-2"
        >
          {footerLabel}
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      )}
    </section>
  );
}

/** One row of a list card: a tile, a name and a line under it, and whatever closes the row. */
export function ListRow({
  tile,
  title,
  sub,
  end,
  href,
}: {
  tile: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  end?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      {tile}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{title}</p>
        {sub && <p className="text-muted-foreground truncate text-xs">{sub}</p>}
      </div>
    </>
  );
  return (
    <div className="hover:bg-muted/60 flex items-center gap-3 rounded-xl p-1.5 transition-colors">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {end}
    </div>
  );
}

export function PastelTile({ Icon, tone }: { Icon: LucideIcon; tone: CentreTone }) {
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

// ── The ring ──────────────────────────────────────────────────────────────────────────────

export interface RingSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Who is on the books, as a ring with the total inside and each slice's share beside it. */
export function DistributionRing({
  slices,
  total,
  unit,
  locale,
}: {
  slices: RingSlice[];
  total: number;
  unit: string;
  locale: string;
}) {
  const r = 50;
  const c = 2 * Math.PI * r;
  const gap = 1.6;
  const shown = slices.filter((s) => s.value > 0);
  // A slice too thin to carry the gap is drawn without one, so it never vanishes.
  let offset = 0;

  return (
    <div className="my-auto flex flex-col-reverse items-center gap-4 pt-3 sm:flex-row sm:gap-6" data-testid="distribution-ring">
      <ul className="w-full min-w-0 flex-1 divide-y divide-[var(--border)]">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 py-2.5 text-sm">
            <span className="size-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
            <span className="shrink-0 font-bold tabular-nums">{`${formatNumber(total > 0 ? Math.round((s.value / total) * 100) : 0, locale)}%`}</span>
          </li>
        ))}
      </ul>
      <div className="relative size-44 shrink-0">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--muted)" strokeWidth="15" />
          {shown.map((s) => {
            const length = (s.value / total) * c;
            const drawn = shown.length > 1 && length > gap * 2 ? length - gap : length;
            const dash = (
              <circle
                key={s.key}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="15"
                strokeDasharray={`${drawn} ${c - drawn}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return dash;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl leading-none font-extrabold tabular-nums">{formatNumber(total, locale)}</span>
          <span className="text-muted-foreground mt-1 text-sm">{unit}</span>
        </div>
      </div>
    </div>
  );
}

// ── The chart ─────────────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  /** YYYY-MM */
  month: string;
  value: number;
}

/** 0 to a round ceiling over the data, in `steps` equal steps. */
function niceScale(max: number, steps: number): number {
  if (max <= 0) return steps;
  const rough = max / steps;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= rough) ?? 10 * magnitude;
  // Counts have no fractions: never a step under 1.
  return Math.max(unit, 1) * steps;
}

/**
 * A smooth line that never leaves the range of its points (monotone cubic, Fritsch-Carlson): a month
 * at zero after a good month stays on the floor instead of dipping below it into negative money.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  const [first] = points;
  if (first === undefined) return "";
  const slopes = points.slice(1).map((p, i) => (p.y - points[i]!.y) / (p.x - points[i]!.x));
  const tangents = points.map((_, i) => {
    const before = slopes[i - 1];
    const after = slopes[i];
    if (before === undefined) return after ?? 0;
    if (after === undefined) return before;
    // A turning point or a flat stretch is flat here; otherwise the harmonic mean, which cannot overshoot.
    return before * after <= 0 ? 0 : (2 * before * after) / (before + after);
  });
  let d = `M${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const third = (b.x - a.x) / 3;
    d += ` C${(a.x + third).toFixed(1)} ${(a.y + tangents[i]! * third).toFixed(1)} ${(b.x - third).toFixed(1)} ${(b.y - tangents[i + 1]! * third).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Month by month: a line, its dots, the grid and both axes, and a label on the month under the
 * pointer (the latest until one is hovered). Drawn at the card's real width rather than stretched by
 * a viewBox, so the dots stay round and the labels stay text. Time runs left to right in both
 * languages, as on every chart in the product.
 */
export function TrendChart({
  points,
  format,
  unitsPerAxisStep = 1,
  monthLabel,
  shortMonthLabel,
  label,
}: {
  points: TrendPoint[];
  format: (value: number) => string;
  /** Minor units per major for an amount (100), so the axis reads 300K and not 30M. */
  unitsPerAxisStep?: number;
  /** "ديسمبر 2026", on the label. */
  monthLabel: (month: string) => string;
  /** "ديسمبر", on the axis. */
  shortMonthLabel: (month: string) => string;
  /** What the chart shows, for a screen reader. */
  label: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const read = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = 228;
  const inset = { top: 16, end: 24, bottom: 26, start: 44 };
  const steps = 6;
  const ceiling = useMemo(
    () => niceScale(Math.max(0, ...points.map((p) => p.value)) / unitsPerAxisStep, steps) * unitsPerAxisStep,
    [points, unitsPerAxisStep],
  );

  const plotWidth = Math.max(width - inset.start - inset.end, 10);
  const plotHeight = height - inset.top - inset.bottom;
  const x = (i: number) => inset.start + (points.length > 1 ? (i / (points.length - 1)) * plotWidth : plotWidth / 2);
  const y = (value: number) => inset.top + plotHeight - (value / ceiling) * plotHeight;

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const line = smoothPath(coords);
  const floor = inset.top + plotHeight;
  const lastX = coords[coords.length - 1]?.x ?? inset.start;
  const firstX = coords[0]?.x ?? inset.start;
  const axis = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

  const active = hover ?? points.length - 1;
  const activePoint = points[active];
  const activeCoord = coords[active];
  // Every month on the axis if they fit; every other one on a phone's twelve.
  const labelEvery = points.length > 6 && width < 520 ? 2 : 1;

  const pick = (clientX: number, rect: DOMRect) => {
    const at = clientX - rect.left;
    let nearest = 0;
    coords.forEach((c, i) => {
      if (Math.abs(c.x - at) < Math.abs((coords[nearest]?.x ?? 0) - at)) nearest = i;
    });
    setHover(nearest);
  };

  return (
    <div ref={frame} dir="ltr" className="relative mt-2 w-full" data-testid="trend-chart">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        className="block max-w-full touch-pan-y"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--chart-1)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {Array.from({ length: steps + 1 }, (_, i) => {
          const value = (ceiling / steps) * i;
          const at = y(value);
          return (
            <g key={i}>
              <line x1={inset.start} x2={width - inset.end} y1={at} y2={at} stroke="var(--border)" strokeWidth="1" />
              <text x={inset.start - 8} y={at + 4} textAnchor="end" fontSize="12" fill="var(--muted-foreground)">
                {axis.format(value / unitsPerAxisStep)}
              </text>
            </g>
          );
        })}

        {points.map((p, i) =>
          i % labelEvery === (points.length - 1) % labelEvery ? (
            <text key={p.month} x={x(i)} y={height - 6} textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">
              {shortMonthLabel(p.month)}
            </text>
          ) : null,
        )}

        {coords.length > 1 && <path d={`${line} L${lastX.toFixed(1)} ${floor} L${firstX.toFixed(1)} ${floor} Z`} fill="url(#trend-fill)" />}
        <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        {coords.map((c, i) => (
          <circle
            key={points[i]?.month}
            cx={c.x}
            cy={c.y}
            r={i === active ? 6 : 4}
            fill={i === active ? "var(--card)" : "var(--chart-1)"}
            stroke="var(--chart-1)"
            strokeWidth={i === active ? 3 : 0}
          />
        ))}
      </svg>

      {activePoint && activeCoord && (
        <div
          className="bg-popover text-popover-foreground pointer-events-none absolute z-10 rounded-xl border px-3 py-1.5 text-center whitespace-nowrap shadow-lg"
          style={{
            // Kept inside the card at both ends of the line.
            left: Math.min(Math.max(activeCoord.x, 62), width - 62),
            // Above the dot, or under it when the line runs along the top of the chart.
            top: activeCoord.y >= 70 ? activeCoord.y - 66 : activeCoord.y + 14,
            transform: "translateX(-50%)",
          }}
          data-testid="trend-tooltip"
        >
          <p className="text-muted-foreground text-xs" dir="auto">
            {monthLabel(activePoint.month)}
          </p>
          <p className="text-sm font-extrabold tabular-nums" dir="auto">
            {format(activePoint.value)}
          </p>
        </div>
      )}
    </div>
  );
}

/** The period control at a chart's corner. */
export function PeriodMenu<T extends number>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: readonly T[];
  label: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button
          type="button"
          data-testid="trend-period"
          className="border-border hover:bg-muted focus-visible:ring-ring/50 flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors outline-none focus-visible:ring-2"
        >
          {label(value)}
          <ChevronDown className="text-muted-foreground size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map((option) => (
          <DropdownMenuItem key={option} onClick={() => onChange(option)} closeOnClick>
            {label(option)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "ديسمبر" / "December" for a YYYY-MM, in the workspace's digits. */
export function monthFormatter(locale: string, withYear: boolean): (month: string) => string {
  const fmt = new Intl.DateTimeFormat(numeralLocale(locale), {
    month: "long",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
  return (month) => fmt.format(new Date(`${month}-15T12:00:00Z`));
}
