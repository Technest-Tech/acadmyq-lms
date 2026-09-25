"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { ChipTone } from "@/components/admin/status-chip";
import type { InsightScores } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The small visual vocabulary of the Teacher performance page, defined once so a green number
 * means the same thing on the tiles, in the table and in a teacher's detail.
 */

export type Tier = "excellent" | "good" | "fair" | "weak";

/** One set of cut-offs for every rate and score on the page. */
export function tierOf(rate: number | null): Tier | null {
  if (rate === null) return null;
  if (rate >= 90) return "excellent";
  if (rate >= 75) return "good";
  if (rate >= 60) return "fair";
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

/** Text color for a rate: loud only when it is very good or needs attention. */
export function rateText(rate: number | null): string {
  const tier = tierOf(rate);
  return tier ? TIER_TEXT[tier] : "text-muted-foreground";
}

/** A rate as "87%", or an em dash when there was nothing to measure. */
export function fmtRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate)}%`;
}

/**
 * Minutes → "45 min", "2 h 10 min", "1 d 3 h". Negative (early) reads as zero — the averages are
 * already clamped server-side; this only guards a single lesson's own delay.
 */
export function useDuration(): (minutes: number | null) => string {
  const t = useTranslations("teacherInsights.dur");
  return useCallback(
    (minutes: number | null) => {
      if (minutes === null) return "—";
      const m = Math.max(0, minutes);
      if (m < 10) return t("min", { n: Math.round(m * 10) / 10 });
      const whole = Math.round(m);
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

/** Segment fills, by severity. Status colours only — never reused for anything else here. */
export const SEG = {
  good: "bg-emerald-500",
  warn: "bg-amber-400",
  crit: "bg-rose-500",
  muted: "bg-slate-300 dark:bg-slate-600",
} as const;

export interface Segment {
  key: string;
  value: number;
  tone: keyof typeof SEG;
  label: string;
}

/**
 * Part-to-whole in one thin bar: segments in severity order with a 2px surface gap between them,
 * each carrying its label + count as a tooltip. An empty track when there is nothing to split.
 */
export function SplitBar({
  segments,
  className,
  testId,
}: {
  segments: Segment[];
  className?: string;
  testId?: string;
}) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div
      className={cn("bg-muted flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full", className)}
      role="img"
      aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}
      data-testid={testId}
    >
      {shown.map((s) => (
        <span
          key={s.key}
          className={cn("h-full min-w-[3px]", SEG[s.tone])}
          style={{ flexGrow: s.value, flexBasis: 0 }}
          title={`${s.label} · ${s.value}`}
        />
      ))}
    </div>
  );
}

/** The legend under a split bar: dot, label, count — identity is never colour alone. */
export function SplitLegend({ segments, className }: { segments: Segment[]; className?: string }) {
  return (
    <ul className={cn("text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[11px]", className)}>
      {segments.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", SEG[s.tone])} aria-hidden />
          {s.label}
          <span className="text-foreground font-semibold tabular-nums">{s.value}</span>
        </li>
      ))}
    </ul>
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
        {score === null ? "—" : Math.round(score)}
      </span>
    </div>
  );
}

// ── The three splits, built one way for the tiles, the table and the detail ────

type T = ReturnType<typeof useTranslations>;

export function joinSegments(s: InsightScores, t: T): Segment[] {
  return [
    { key: "on_time", value: s.join.on_time, tone: "good", label: t("legend.onTime") },
    { key: "late", value: s.join.late, tone: "warn", label: t("legend.late") },
    { key: "missed", value: s.join.missed, tone: "crit", label: t("legend.missed") },
  ];
}

export function reportSegments(s: InsightScores, t: T): Segment[] {
  return [
    { key: "on_time", value: s.reports.on_time, tone: "good", label: t("legend.onTime") },
    { key: "late", value: s.reports.late, tone: "warn", label: t("legend.late") },
    { key: "missing", value: s.reports.missing, tone: "crit", label: t("legend.missing") },
  ];
}

export function attendanceSegments(s: InsightScores, t: T): Segment[] {
  return [
    { key: "taught", value: s.attendance.attended + s.attendance.free, tone: "good", label: t("legend.taught") },
    { key: "student_absent", value: s.attendance.student_absent, tone: "muted", label: t("legend.studentAbsent") },
    { key: "teacher_absent", value: s.attendance.teacher_absent, tone: "crit", label: t("legend.teacherAbsent") },
  ];
}
