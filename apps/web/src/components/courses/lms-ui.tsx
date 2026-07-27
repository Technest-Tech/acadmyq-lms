"use client";

import type { LucideIcon } from "lucide-react";
import {
  FileText,
  ListChecks,
  Music,
  PlayCircle,
  Search,
  Sparkles,
  Tag,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LessonType } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The shared visual kit for the course-platform (LMS) surfaces — page headers, stat tiles, panels,
 * filters, tables and empty states. Every LMS screen is assembled from these, so the four pages read
 * as one product and a change to the module's look lands in one file.
 *
 * The colour vocabulary (gradient chip + accent stripe + blurred glow) is deliberately the same one
 * the academy dashboard uses, so the workspace feels like the same app rather than a bolt-on.
 */

// ── Colour system ──────────────────────────────────────────────────────────────

export interface LmsColor {
  /** Gradient for an icon chip — a white glyph sits on top. */
  chip: string;
  /** Gradient for a card's top accent stripe. */
  stripe: string;
  /** Blurred decorative blob tint. */
  glow: string;
  /** Accent text colour. */
  text: string;
  /** Low-contrast tinted surface for soft badges. */
  soft: string;
}

export const LMS_COLORS: Record<string, LmsColor> = {
  violet: {
    chip: "from-violet-500 to-purple-500",
    stripe: "from-violet-500 to-purple-500",
    glow: "bg-violet-500/20",
    text: "text-violet-600 dark:text-violet-400",
    soft: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  },
  indigo: {
    chip: "from-indigo-500 to-violet-500",
    stripe: "from-indigo-500 to-violet-500",
    glow: "bg-indigo-500/20",
    text: "text-indigo-600 dark:text-indigo-400",
    soft: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  },
  blue: {
    chip: "from-blue-500 to-indigo-500",
    stripe: "from-blue-500 to-indigo-500",
    glow: "bg-blue-500/20",
    text: "text-blue-600 dark:text-blue-400",
    soft: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  sky: {
    chip: "from-sky-500 to-blue-500",
    stripe: "from-sky-500 to-blue-500",
    glow: "bg-sky-500/20",
    text: "text-sky-600 dark:text-sky-400",
    soft: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  },
  cyan: {
    chip: "from-cyan-500 to-sky-500",
    stripe: "from-cyan-500 to-sky-500",
    glow: "bg-cyan-500/20",
    text: "text-cyan-600 dark:text-cyan-400",
    soft: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  },
  teal: {
    chip: "from-teal-500 to-cyan-500",
    stripe: "from-teal-500 to-cyan-500",
    glow: "bg-teal-500/20",
    text: "text-teal-600 dark:text-teal-400",
    soft: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  },
  emerald: {
    chip: "from-emerald-500 to-teal-500",
    stripe: "from-emerald-500 to-teal-500",
    glow: "bg-emerald-500/20",
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  amber: {
    chip: "from-amber-500 to-orange-500",
    stripe: "from-amber-500 to-orange-500",
    glow: "bg-amber-500/20",
    text: "text-amber-600 dark:text-amber-400",
    soft: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  orange: {
    chip: "from-orange-500 to-red-500",
    stripe: "from-orange-500 to-red-500",
    glow: "bg-orange-500/20",
    text: "text-orange-600 dark:text-orange-400",
    soft: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  },
  rose: {
    chip: "from-rose-500 to-pink-500",
    stripe: "from-rose-500 to-pink-500",
    glow: "bg-rose-500/20",
    text: "text-rose-600 dark:text-rose-400",
    soft: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
  fuchsia: {
    chip: "from-fuchsia-500 to-pink-500",
    stripe: "from-fuchsia-500 to-pink-500",
    glow: "bg-fuchsia-500/20",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    soft: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
  },
  slate: {
    chip: "from-slate-500 to-slate-600",
    stripe: "from-slate-400 to-slate-500",
    glow: "bg-slate-500/20",
    text: "text-slate-600 dark:text-slate-300",
    soft: "bg-muted text-muted-foreground",
  },
};

export function lmsColor(name: string | undefined): LmsColor {
  return LMS_COLORS[name ?? "violet"] ?? LMS_COLORS.violet!;
}

/**
 * Each lesson kind's glyph and tint. Shared by the curriculum outline and the lesson form so a kind
 * looks identical wherever it appears — a long outline stays scannable by shape and colour alone.
 */
export const LESSON_STYLE: Record<LessonType, { Icon: LucideIcon; color: string }> = {
  YOUTUBE: { Icon: Video, color: "rose" },
  VIDEO_UPLOAD: { Icon: PlayCircle, color: "violet" },
  TEXT: { Icon: FileText, color: "blue" },
  PDF: { Icon: FileText, color: "amber" },
  AUDIO: { Icon: Music, color: "teal" },
  QUIZ: { Icon: ListChecks, color: "emerald" },
};

// ── Loading primitives ─────────────────────────────────────────────────────────

/** Shimmer placeholder — the LMS screens never render a bare "…" while loading. */
export function Sk({ className }: { className?: string }) {
  return <div className={cn("bg-muted animate-pulse rounded-md", className)} />;
}

/** Counts up from zero on mount, so a freshly loaded figure lands instead of appearing. */
export function CountUp({ value, locale }: { value: number; locale: string }) {
  const [displayed, setDisplayed] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const startTime = performance.now();
    const duration = 700;

    function tick(now: number) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(value * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value]);

  return <span>{formatNumber(displayed, locale)}</span>;
}

// ── Page headers ───────────────────────────────────────────────────────────────

/**
 * The workspace-home banner — a saturated gradient with a dot grid, glow orbs and a watermark
 * glyph. Exactly one of these per workspace (the LMS home); every other page uses {@link PageHeader}
 * so the hierarchy stays readable.
 */
export function LmsHero({
  Icon,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  Icon: LucideIcon;
  eyebrow?: ReactNode;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-6 text-white shadow-lg sm:p-7">
      <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.18]" aria-hidden>
        <defs>
          <pattern id="lms-hero-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lms-hero-dots)" />
      </svg>
      <div className="pointer-events-none absolute -top-16 -end-12 size-56 rounded-full bg-white/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 start-1/4 size-48 rounded-full bg-fuchsia-400/30 blur-3xl" />
      <Icon
        className="pointer-events-none absolute -bottom-6 -end-4 size-40 opacity-10"
        strokeWidth={1}
        aria-hidden
      />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className="flex items-center gap-2 text-xs font-medium text-white/80">{eyebrow}</div>
          )}
          <h1 className="mt-1.5 truncate text-2xl font-bold tracking-tight drop-shadow-sm sm:text-[1.7rem]">
            {title}
          </h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-white/85">{subtitle}</p>}
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}

/**
 * The standard page banner for a sub-surface: a soft tinted card with a gradient icon chip, the
 * title/description and an action slot. Quieter than {@link LmsHero} on purpose — a workspace with
 * five competing gradient banners reads as noise, not hierarchy.
 */
export function PageHeader({
  Icon,
  color = "violet",
  title,
  subtitle,
  actions,
  children,
}: {
  Icon: LucideIcon;
  color?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const c = lmsColor(color);
  return (
    <header className="bg-card relative overflow-hidden rounded-2xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", c.stripe)} />
      <div
        className={cn(
          "pointer-events-none absolute -top-20 -end-10 size-48 rounded-full blur-3xl",
          c.glow,
        )}
      />
      <Icon
        className="text-foreground/[0.03] dark:text-foreground/[0.05] pointer-events-none absolute -bottom-6 -end-4 size-32"
        strokeWidth={1.25}
        aria-hidden
      />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md",
              c.chip,
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="text-muted-foreground mt-0.5 max-w-2xl text-sm">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </header>
  );
}

/** A group heading inside a page — gradient chip, title and optional description/action. */
export function SectionTitle({
  Icon,
  color = "violet",
  title,
  desc,
  action,
}: {
  Icon?: LucideIcon;
  color?: string;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  const c = lmsColor(color);
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
              c.chip,
            )}
          >
            <Icon className="size-4" />
          </span>
        )}
        <div>
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          {desc && <p className="text-muted-foreground mt-0.5 text-xs">{desc}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ── Stats ──────────────────────────────────────────────────────────────────────

/**
 * A headline metric tile: accent stripe, gradient chip, blurred glow and a watermark glyph, with an
 * optional usage bar. `value` of `null` while `loading` renders skeleton lines instead of a zero.
 */
export function StatCard({
  Icon,
  color = "violet",
  label,
  value,
  hint,
  loading = false,
  href,
  locale,
  progress,
  progressLabel,
  animate = true,
}: {
  Icon: LucideIcon;
  color?: string;
  label: string;
  /** A number counts up; a string (e.g. formatted bytes) renders as-is. */
  value: number | string | null;
  hint?: string;
  loading?: boolean;
  href?: string;
  locale: string;
  /** 0–100; renders a usage bar under the figure. */
  progress?: number;
  progressLabel?: string;
  animate?: boolean;
}) {
  const c = lmsColor(color);
  const inner = (
    <div
      className={cn(
        "group bg-card relative flex h-full flex-col overflow-hidden rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06] transition-all duration-200",
        href && "hover:-translate-y-0.5 hover:shadow-lg",
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", c.stripe)} />
      <div
        className={cn(
          "pointer-events-none absolute -top-10 -end-8 size-28 rounded-full blur-3xl transition-transform duration-500 group-hover:scale-125",
          c.glow,
        )}
      />
      <Icon
        className="text-foreground/[0.03] dark:text-foreground/[0.05] pointer-events-none absolute -bottom-4 -end-3 size-24"
        strokeWidth={1.25}
        aria-hidden
      />

      <span
        className={cn(
          "relative flex size-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md",
          c.chip,
        )}
      >
        <Icon className="size-5" />
      </span>

      <div className="relative mt-3.5">
        {loading || value === null ? (
          <>
            <Sk className="mb-2 h-8 w-20" />
            <Sk className="h-3.5 w-24" />
          </>
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight tabular-nums">
              {typeof value === "number" && animate ? (
                <CountUp value={value} locale={locale} />
              ) : typeof value === "number" ? (
                formatNumber(value, locale)
              ) : (
                value
              )}
            </p>
            <p className="text-foreground/80 mt-0.5 text-sm font-semibold">{label}</p>
            {hint && <p className={cn("mt-0.5 text-xs font-medium", c.text)}>{hint}</p>}
          </>
        )}
      </div>

      {!loading && progress !== undefined && (
        <div className="relative mt-3">
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full bg-gradient-to-r transition-all duration-700",
                progress >= 90 ? "from-rose-500 to-red-500" : c.stripe,
              )}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          {progressLabel && (
            <p className="text-muted-foreground mt-1.5 text-[11px]">{progressLabel}</p>
          )}
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/**
 * The compact counterpart of {@link StatCard} for a page's summary strip — an inline chip, the
 * figure and its label, with no decoration competing against the content below.
 */
export function MiniStat({
  Icon,
  color = "slate",
  label,
  value,
  loading = false,
  locale,
}: {
  Icon: LucideIcon;
  color?: string;
  label: string;
  value: number | string | null;
  loading?: boolean;
  locale: string;
}) {
  const c = lmsColor(color);
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl p-3.5 shadow-sm ring-1 ring-foreground/[0.06]">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
          c.chip,
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        {loading || value === null ? (
          <Sk className="h-6 w-12" />
        ) : (
          <p className="text-xl leading-tight font-bold tracking-tight tabular-nums">
            {typeof value === "number" ? formatNumber(value, locale) : value}
          </p>
        )}
        <p className="text-muted-foreground truncate text-xs font-medium">{label}</p>
      </div>
    </div>
  );
}

// ── Surfaces ───────────────────────────────────────────────────────────────────

/** A titled content card. `flush` drops the body padding for edge-to-edge lists and tables. */
export function Panel({
  Icon,
  color = "slate",
  title,
  action,
  flush = false,
  className,
  children,
}: {
  Icon?: LucideIcon;
  color?: string;
  title?: string;
  action?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const c = lmsColor(color);
  return (
    <section
      className={cn(
        "bg-card overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]",
        className,
      )}
    >
      {title && (
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
            {Icon && (
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
                  c.chip,
                )}
              >
                <Icon className="size-3.5" />
              </span>
            )}
            {title}
          </h2>
          {action}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

/** The illustrated zero state — a tinted glyph, a headline, a line of guidance and an optional CTA. */
export function EmptyState({
  Icon,
  color = "violet",
  title,
  description,
  action,
  className,
}: {
  Icon: LucideIcon;
  color?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  const c = lmsColor(color);
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center",
        className,
      )}
    >
      <span className="relative mb-4 flex size-16 items-center justify-center">
        <span className={cn("absolute inset-0 rounded-2xl blur-xl", c.glow)} />
        <span
          className={cn(
            "relative flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg",
            c.chip,
          )}
        >
          <Icon className="size-6" />
        </span>
      </span>
      <p className="text-base font-semibold tracking-tight">{title}</p>
      {description && (
        <p className="text-muted-foreground mt-1.5 max-w-sm text-sm leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Price ──────────────────────────────────────────────────────────────────────

/**
 * A course's price as a pill: an emerald "Free" chip when `priceMinor` is 0, otherwise the amount
 * formatted in the academy's currency. One component so the catalogue card, the list row and the
 * editor all label price identically. `free` (from the API's derived flag) wins when passed, so the
 * 0-means-free rule lives on the server, not in three call sites.
 */
export function PriceTag({
  priceMinor,
  currency,
  free,
  freeLabel,
  locale,
  size = "sm",
  className,
}: {
  priceMinor: number;
  currency: string;
  free?: boolean;
  freeLabel: string;
  locale: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const isFree = free ?? priceMinor === 0;
  const lg = size === "lg";

  if (isFree) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold ring-1 ring-inset",
          "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20",
          lg ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
          className,
        )}
      >
        <Sparkles className={lg ? "size-4" : "size-3"} aria-hidden />
        {freeLabel}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold tabular-nums ring-1 ring-inset",
        "bg-primary/10 text-primary ring-primary/20",
        lg ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      <Tag className={lg ? "size-3.5" : "size-3"} aria-hidden />
      {formatMoney({ amount: priceMinor, currency }, locale)}
    </span>
  );
}

// ── Controls ───────────────────────────────────────────────────────────────────

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Rendered as a pill beside the label — omit for segments with nothing to count. */
  count?: number;
}

/**
 * A segmented control for list filters — one sliding-highlight group instead of loose buttons, with
 * the matching row count on each segment so the filter doubles as the summary.
 */
export function SegmentedFilter<T extends string>({
  options,
  value,
  onChange,
  locale,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  locale: string;
}) {
  return (
    <div className="bg-muted/60 inline-flex items-center gap-0.5 rounded-xl p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  "rounded-md px-1.5 text-[11px] font-semibold tabular-nums",
                  active ? "bg-primary/10 text-primary" : "bg-foreground/[0.06]",
                )}
              >
                {formatNumber(o.count, locale)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A search box with a leading glyph and a clear button once there's something to clear. */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-xl border ps-9 pe-8 text-sm outline-none transition-shadow focus-visible:ring-3"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear"
          className="text-muted-foreground hover:bg-muted hover:text-foreground absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1 transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Badges ─────────────────────────────────────────────────────────────────────

export type PillTone = "emerald" | "amber" | "rose" | "blue" | "violet" | "slate";

const PILL_TONES: Record<PillTone, { wrap: string; dot: string }> = {
  emerald: {
    wrap: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20",
    dot: "bg-emerald-500",
  },
  amber: {
    wrap: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20",
    dot: "bg-amber-500",
  },
  rose: {
    wrap: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-400/20",
    dot: "bg-rose-500",
  },
  blue: {
    wrap: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20",
    dot: "bg-blue-500",
  },
  violet: {
    wrap: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-400/20",
    dot: "bg-violet-500",
  },
  slate: {
    wrap: "bg-muted text-muted-foreground ring-foreground/10",
    dot: "bg-muted-foreground/60",
  },
};

/** A status pill with a leading dot — readable at a glance without relying on colour alone. */
export function StatusPill({
  tone,
  children,
  dot = true,
  className,
}: {
  tone: PillTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const s = PILL_TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        s.wrap,
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />}
      {children}
    </span>
  );
}

/** Initials avatar — a deterministic tint per name so rows stay visually distinguishable. */
export function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const palette = ["violet", "indigo", "blue", "cyan", "teal", "emerald", "amber", "rose"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const c = lmsColor(palette[hash % palette.length]);

  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-bold text-white shadow-sm",
        c.chip,
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

// ── Table shell ────────────────────────────────────────────────────────────────

/** Shared table styling — one look for the codes and learners grids. */
export const tableHeadClass =
  "bg-muted/40 text-muted-foreground text-[0.7rem] font-semibold uppercase tracking-wider";
export const thClass = "px-4 py-2.5 text-start font-semibold whitespace-nowrap";
export const tdClass = "px-4 py-3 align-middle";
export const trClass = "hover:bg-muted/40 transition-colors";

/** Placeholder rows shown while a table's first payload is in flight. */
export function TableSkeleton({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <tbody className="divide-y">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className={tdClass}>
              <Sk className={cn("h-4", c === 0 ? "w-32" : "w-16")} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
