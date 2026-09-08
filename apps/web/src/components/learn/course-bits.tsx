"use client";

import {
  BookOpen,
  FileText,
  Headphones,
  HelpCircle,
  PlayCircle,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import type { LearnLessonType } from "@/lib/learn-api";
import { splitDuration } from "@/lib/learn-format";
import { cn } from "@/lib/utils";

/**
 * The small vocabulary the course surfaces share (docs/lms/09) — runtimes, lesson-type glyphs,
 * progress indicators, cover art. Catalogue card, sales page, player and "my learning" all speak it,
 * so a PDF lesson looks the same everywhere and a runtime is written the same way everywhere.
 */

// ── runtimes ──────────────────────────────────────────────────────────────────

/**
 * Formats a runtime the way a course platform does: "4h 12m" for a course, "6m" for a lesson,
 * "45s" only when that is all there is. The words (and, in Arabic, the digits) come from the
 * message catalogue, which is why this is a hook rather than a plain function.
 */
export function useFormatDuration(): (seconds: number | null | undefined) => string | null {
  const t = useTranslations("learn.units");

  return (seconds) => {
    if (seconds == null || seconds <= 0) return null;
    const { h, m, s } = splitDuration(seconds);
    if (h > 0) return m > 0 ? t("hm", { h, m }) : t("h", { h });
    if (m > 0) return t("m", { m });
    return t("s", { s });
  };
}

// ── lesson types ──────────────────────────────────────────────────────────────

const LESSON_ICONS: Record<LearnLessonType, LucideIcon> = {
  VIDEO_UPLOAD: Video,
  YOUTUBE: PlayCircle,
  AUDIO: Headphones,
  PDF: FileText,
  TEXT: BookOpen,
  QUIZ: HelpCircle,
};

export function LessonTypeIcon({ type, className }: { type: LearnLessonType; className?: string }) {
  const Icon = LESSON_ICONS[type] ?? PlayCircle;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

/** "Video", "Quiz", "Reading" … — the label beside a lesson row's glyph. */
export function useLessonTypeLabel(): (type: LearnLessonType) => string {
  const t = useTranslations("learn.lessonType");
  return (type) => t(type);
}

// ── progress ──────────────────────────────────────────────────────────────────

/**
 * A circular percentage. Used where a bar would be noise (a course tile, the player's top bar):
 * the ring reads at a glance and the number inside answers "how much is left".
 */
export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  className,
  children,
}: {
  /** 0–100. */
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      {/* -90° start puts 0% at 12 o'clock; the ring is decorative, the label carries the value. */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="stroke-primary transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums">
        {children ?? `${pct}%`}
      </span>
    </span>
  );
}

export function ProgressBar({
  value,
  className,
  tone = "primary",
}: {
  /** 0–100. */
  value: number;
  className?: string;
  tone?: "primary" | "emerald";
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span className={cn("bg-muted block h-1.5 overflow-hidden rounded-full", className)}>
      <span
        className={cn(
          "block h-full rounded-full transition-[width] duration-500",
          tone === "emerald" ? "bg-emerald-500" : "bg-primary",
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

// ── odds and ends ─────────────────────────────────────────────────────────────

/** An icon + fact pair — the meta row under a course title. */
export function Meta({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
      {children}
    </span>
  );
}

/**
 * A course's cover art, with the brand-tinted fallback for a course that has none — so a catalogue
 * of un-illustrated courses still looks deliberate rather than broken.
 *
 * The fallback is a designed placeholder, not an error state: the academy's own colour, a soft dot
 * grid and one glyph. That is the difference between "this course has no picture yet" and "this
 * image failed to load", and on a young catalogue most covers are the former.
 */
export function CourseThumb({
  src,
  alt = "",
  className,
  iconClassName,
  /** `eager` for the one cover above the fold; everything in a grid stays lazy. */
  loading = "lazy",
  children,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  iconClassName?: string;
  loading?: "lazy" | "eager";
  children?: ReactNode;
}) {
  return (
    <div className={cn("bg-muted relative overflow-hidden", className)}>
      {src ? (
        // Absolute, so the picture's intrinsic height can never become the min-height of a flex
        // item and stretch the card past the aspect ratio its caller asked for.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          loading={loading}
          decoding="async"
        />
      ) : (
        <div
          className="relative flex size-full items-center justify-center"
          style={{ background: "linear-gradient(140deg, var(--brand-soft), transparent 72%)" }}
        >
          <span
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
              backgroundSize: "18px 18px",
            }}
            aria-hidden
          />
          <BookOpen
            className={cn("text-primary/40 relative size-8", iconClassName)}
            aria-hidden
          />
        </div>
      )}
      {children}
    </div>
  );
}

/** A pill of secondary information (price, badge, count) with the site's rounding and weight. */
export function Pill({
  className,
  children,
  ...props
}: ComponentProps<"span"> & { children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
