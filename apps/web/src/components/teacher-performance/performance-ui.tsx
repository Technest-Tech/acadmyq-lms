"use client";

import { ClipboardCheck, DoorOpen, FileText, ShieldCheck, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { ChipTone } from "@/components/admin/status-chip";
import type { PerformancePart } from "@/lib/api";
import { academyToday } from "@/lib/academy-clock";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";

/**
 * The small visual vocabulary of the Teacher performance page, defined once so a green number
 * means the same thing on a teacher's card, in the page's tiles and in a teacher's detail.
 */

export type Tier = "excellent" | "good" | "fair" | "weak";

/** One set of cut-offs for every score on the page. */
export function tierOf(score: number | null): Tier | null {
  if (score === null) return null;
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "fair";
  return "weak";
}

export const TIER_CHIP: Record<Tier, ChipTone> = {
  excellent: "good",
  good: "accent",
  fair: "warn",
  weak: "crit",
};

const TIER_TEXT: Record<Tier, string> = {
  excellent: "text-emerald-600 dark:text-emerald-400",
  good: "text-foreground",
  fair: "text-amber-600 dark:text-amber-400",
  weak: "text-rose-600 dark:text-rose-400",
};

const TIER_STROKE: Record<Tier, string> = {
  excellent: "stroke-emerald-500",
  good: "stroke-primary",
  fair: "stroke-amber-500",
  weak: "stroke-rose-500",
};

const TIER_FILL: Record<Tier, string> = {
  excellent: "bg-emerald-500",
  good: "bg-primary",
  fair: "bg-amber-500",
  weak: "bg-rose-500",
};

/** Text colour for a score: loud only when it is very good or needs attention. */
export function scoreText(score: number | null): string {
  const tier = tierOf(score);
  return tier ? TIER_TEXT[tier] : "text-muted-foreground";
}

/** A score as "87", or an em dash when there was nothing to measure. */
export function fmtScore(score: number | null): string {
  return score === null ? "—" : String(Math.round(score));
}

/** The four parts of the total, in the order the page always lists them. */
export const PARTS: readonly PerformancePart[] = ["quality", "reports", "entry", "conduct"];

export const PART_ICON: Record<PerformancePart, LucideIcon> = {
  quality: ClipboardCheck,
  reports: FileText,
  entry: DoorOpen,
  conduct: ShieldCheck,
};

/** A 0–100 score as a thin bar, coloured by its tier. An empty track when there is no score. */
export function Meter({ score, className }: { score: number | null; className?: string }) {
  const tier = tierOf(score);
  return (
    <div className={cn("bg-border/70 h-1.5 overflow-hidden rounded-full", className)} aria-hidden>
      {score !== null && tier && (
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", TIER_FILL[tier])}
          style={{ width: `${Math.min(100, Math.max(score, 2))}%` }}
        />
      )}
    </div>
  );
}

/** A 0–100 score as a ring with the number inside. */
export function ScoreRing({
  score,
  size = 44,
  stroke = 4,
  className,
}: {
  score: number | null;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const tier = tierOf(score);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score ?? 0)) / 100);

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          className="fill-none stroke-slate-200 dark:stroke-slate-700"
        />
        {score !== null && tier && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn("fill-none transition-[stroke-dashoffset] duration-500", TIER_STROKE[tier])}
          />
        )}
      </svg>
      <span
        className="absolute font-bold tabular-nums"
        style={{ fontSize: Math.max(11, Math.round(size * 0.3)) }}
        dir="ltr"
      >
        {fmtScore(score)}
      </span>
    </div>
  );
}

/**
 * Minutes → "45 min", "2 h 10 min", "1 d 3 h". Negative (early) reads as zero.
 */
export function useDuration(): (minutes: number | null) => string {
  const t = useTranslations("teacherPerformance.dur");
  return useCallback(
    (minutes: number | null) => {
      if (minutes === null) return "—";
      const whole = Math.round(Math.max(0, minutes));
      if (whole < 60) return t("min", { n: whole });
      if (whole < 1440) {
        const h = Math.floor(whole / 60);
        const rest = whole % 60;
        return rest ? t("hm", { h, m: rest }) : t("h", { h });
      }
      const d = Math.floor(whole / 1440);
      const h = Math.floor((whole % 1440) / 60);
      return h ? t("dh", { d, h }) : t("d", { d });
    },
    [t],
  );
}

// ── Months: the page is read one calendar month of the academy at a time ───────

/** The academy's current month as YYYY-MM. */
export function currentMonth(): string {
  return academyToday().slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string, locale: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(
    numeralLocale(locale),
    style === "long" ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", timeZone: "UTC" },
  ).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** A Y-m-d day as "Thu 24 Sep" — a calendar day, so it is formatted in UTC and never shifts. */
export function dayLabel(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(numeralLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export const INPUT_CLASS =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-3";
