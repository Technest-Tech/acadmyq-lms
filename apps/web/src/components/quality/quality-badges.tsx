"use client";

import { CalendarRange, GraduationCap } from "lucide-react";
import { useTranslations } from "next-intl";
import type { QualityScope } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Shared quality primitives. A score is the flip side of the docked percent (100 = nothing wrong),
 * and every surface that shows one colours it the same way — an owner scanning the table and a
 * teacher reading their own report must not learn two different colour languages.
 */

/** Green ≥90, amber ≥70, red below. The thresholds are the UI's only opinion about the numbers. */
export function scoreTone(score: number): {
  text: string;
  ring: string;
  bg: string;
} {
  if (score >= 90) {
    return {
      text: "text-emerald-700 dark:text-emerald-300",
      ring: "stroke-emerald-500",
      bg: "bg-emerald-100 dark:bg-emerald-950/40",
    };
  }
  if (score >= 70) {
    return {
      text: "text-amber-700 dark:text-amber-300",
      ring: "stroke-amber-500",
      bg: "bg-amber-100 dark:bg-amber-950/40",
    };
  }
  return {
    text: "text-red-700 dark:text-red-300",
    ring: "stroke-red-500",
    bg: "bg-red-100 dark:bg-red-950/40",
  };
}

/**
 * A score as a ring. `size` is the px diameter; the ring is drawn with a rotated SVG so it fills
 * clockwise from 12 o'clock in both text directions — a percentage is not a direction-dependent
 * quantity, so it must not mirror under RTL the way a progress bar would.
 */
export function ScoreRing({
  score,
  size = 44,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const tone = scoreTone(score);
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, score));
  const offset = circumference - (filled / 100) * circumference;

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${score}%`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={3}
          className="fill-none stroke-current text-slate-200 dark:text-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn("fill-none transition-[stroke-dashoffset] duration-500", tone.ring)}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums",
          tone.text,
        )}
      >
        {Math.round(score)}
      </span>
    </div>
  );
}

const SCOPE_STYLES: Record<QualityScope, { chip: string; icon: typeof GraduationCap }> = {
  SESSION: {
    chip: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    icon: GraduationCap,
  },
  MONTHLY: {
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    icon: CalendarRange,
  },
};

/** Which pay a report bites into: one lesson, or the whole month. */
export function ScopeBadge({ scope }: { scope: QualityScope }) {
  const t = useTranslations("quality");
  const meta = SCOPE_STYLES[scope];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        meta.chip,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(`scope.${scope}`)}
    </span>
  );
}

/** The percent a report costs. Zero is a PASS and reads green, not as a null result. */
export function PercentBadge({ percent }: { percent: number }) {
  const t = useTranslations("quality");

  if (percent <= 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        {t("passed")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-700 dark:bg-red-950/40 dark:text-red-300">
      −{percent}%
    </span>
  );
}
