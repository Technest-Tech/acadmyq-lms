"use client";

import { CheckCircle2, Clock3, Inbox, XCircle } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";
import type { StudentReportStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The status tabs both report screens filter by — the three real statuses plus "everything". */
export type StatusFilter = "ALL" | StudentReportStatus;

export const STATUS_FILTERS: StatusFilter[] = [
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
];

interface StatusStyle {
  /** Pill (chip) colours. */
  chip: string;
  /** The 3px accent rail down the card's inline-start edge. */
  rail: string;
  /** Icon-tile colours, reused by the stat tiles. */
  tone: string;
  dot: string;
  icon: ComponentType<{ className?: string }>;
}

export const STATUS_STYLE: Record<StudentReportStatus, StatusStyle> = {
  PENDING: {
    chip: "bg-amber-100 text-amber-800 ring-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/50",
    rail: "bg-amber-400 dark:bg-amber-500",
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
    dot: "bg-amber-500",
    icon: Clock3,
  },
  APPROVED: {
    chip: "bg-emerald-100 text-emerald-800 ring-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/50",
    rail: "bg-emerald-500",
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
    dot: "bg-emerald-500",
    icon: CheckCircle2,
  },
  REJECTED: {
    chip: "bg-rose-100 text-rose-800 ring-rose-200/70 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900/50",
    rail: "bg-rose-500",
    tone: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400",
    dot: "bg-rose-500",
    icon: XCircle,
  },
};

/** Colour-coded status chip with a leading dot. */
export function StatusPill({
  status,
  label,
  className,
}: {
  status: StudentReportStatus;
  label: string;
  className?: string;
}) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ring-1 ring-inset",
        s.chip,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {label}
    </span>
  );
}

/**
 * A headline count that doubles as the status filter — clicking it scopes the list below.
 * aria-pressed carries the selected state for screen readers.
 */
export function StatTile({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
  testId,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  active: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "bg-card group relative flex flex-col gap-2 overflow-hidden rounded-2xl border p-3.5 text-start shadow-sm outline-none transition-all",
        "focus-visible:ring-ring/40 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3",
        active
          ? "border-primary/40 ring-primary/15 ring-2"
          : "hover:border-foreground/15",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-110",
            tone,
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
      </span>
      <span className="text-2xl leading-none font-semibold tabular-nums">
        {value}
      </span>
      <span
        className={cn(
          "bg-primary absolute inset-x-0 bottom-0 h-0.5 opacity-0 transition-opacity",
          active && "opacity-100",
        )}
        aria-hidden
      />
    </button>
  );
}

const AVATAR_TONES = [
  "bg-emerald-100 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/50",
  "bg-sky-100 text-sky-700 ring-sky-200/70 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900/50",
  "bg-violet-100 text-violet-700 ring-violet-200/70 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-900/50",
  "bg-amber-100 text-amber-700 ring-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/50",
  "bg-rose-100 text-rose-700 ring-rose-200/70 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900/50",
  "bg-teal-100 text-teal-700 ring-teal-200/70 dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-900/50",
] as const;

/** Deterministic tone per name, so the same student always gets the same colour. */
function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? AVATAR_TONES[0];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  // Spread by code point so Arabic (and any surrogate pair) keeps its first letter intact.
  const first = [...(parts[0] ?? "")][0] ?? "";
  const second =
    parts.length > 1 ? ([...(parts[parts.length - 1] ?? "")][0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Initials avatar — stands in for the student photo we don't have. */
export function InitialsAvatar({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const safe = name?.trim() || "—";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-semibold ring-1 ring-inset",
        toneFor(safe),
        className,
      )}
    >
      {initialsOf(safe)}
    </span>
  );
}

/** A meta line item — icon + text, used for the student/teacher/month chips on a card. */
export function MetaItem({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-3.5 opacity-70" aria-hidden />
      {children}
    </span>
  );
}

/** Report text, clamped to five lines until the reader expands it. */
export function ReportBody({
  text,
  moreLabel,
  lessLabel,
}: {
  text: string;
  moreLabel: string;
  lessLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // Only offer the toggle when there is actually something hidden behind the clamp.
  const long = text.length > 260 || text.split("\n").length > 5;

  return (
    <div className="space-y-1.5">
      <p
        data-testid="report-body"
        className={cn(
          "text-foreground/90 bg-muted/40 ring-foreground/[0.04] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ring-1",
          long && !open && "line-clamp-5",
        )}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="toggle-body"
          className="text-primary hover:text-primary/80 text-xs font-medium underline-offset-4 hover:underline"
        >
          {open ? lessLabel : moreLabel}
        </button>
      )}
    </div>
  );
}

/** Illustrated empty state — used for "nothing here yet" and "nothing matches your filters". */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="bg-card/40 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center"
      data-testid="empty-state"
    >
      <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
        <Icon className="size-6 opacity-70" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/** Shimmering placeholders so the first paint has the shape of the list that's coming. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <ul className="space-y-3" aria-hidden data-testid="skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="bg-card space-y-3 rounded-2xl border p-4 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="bg-muted size-10 animate-pulse rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className="bg-muted h-3.5 w-1/3 animate-pulse rounded-full" />
              <div className="bg-muted h-2.5 w-1/2 animate-pulse rounded-full" />
            </div>
            <div className="bg-muted h-6 w-20 animate-pulse rounded-full" />
          </div>
          <div className="bg-muted/60 h-16 animate-pulse rounded-xl" />
        </li>
      ))}
    </ul>
  );
}

/** "2 days ago" / "منذ يومين" from an ISO timestamp. */
export function relativeTime(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "en", {
    numeric: "auto",
  });
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(Math.round(seconds), "second");
}

/** Shared classes for the text inputs on both report screens. */
export const FIELD_CLASS =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3";
