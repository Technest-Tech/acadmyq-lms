"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { GroupState } from "@/lib/groups-api";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";

/**
 * The group screens' pieces in a learning centre's look (`useCentreLook`): the dashboard's language of
 * white cards, pastel tiles, soft badges and coloured blocks. A Quran academy never renders any of it.
 */
export const PASTEL = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  pink: "bg-pink-100 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
} as const;

export type PastelTone = keyof typeof PASTEL;

const HASHED_TONES: PastelTone[] = ["violet", "sky", "pink", "emerald", "amber", "indigo"];

/** The same text always lands on the same pastel, so a subject or a person keeps their colour. */
export function pastelFor(key: string): string {
  return PASTEL[HASHED_TONES[[...key].reduce((sum, c) => sum + c.charCodeAt(0), 0) % HASHED_TONES.length]!];
}

/** The state as a soft coloured badge. */
export const STATE_BADGE: Record<GroupState, { pill: string; dot: string }> = {
  RUNNING: { pill: PASTEL.emerald, dot: "bg-emerald-500" },
  UPCOMING: { pill: PASTEL.sky, dot: "bg-sky-500" },
  FINISHED: { pill: PASTEL.slate, dot: "bg-slate-400" },
  ARCHIVED: { pill: "bg-zinc-100 text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-400", dot: "bg-zinc-400" },
};

export function SoftBadge({ tone, className, children }: { tone: PastelTone | string; className?: string; children: ReactNode }) {
  const colours = tone in PASTEL ? PASTEL[tone as PastelTone] : tone;
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold", colours, className)}>{children}</span>;
}

/** A titled white card: a pastel tile, the title and its count, and the one control it is about. */
export function SectionCard({
  icon: Icon,
  tone,
  title,
  hint,
  count,
  action,
  flush,
  testId,
  children,
}: {
  icon: LucideIcon;
  tone: PastelTone;
  title: string;
  hint?: string;
  count?: number;
  action?: ReactNode;
  /** The body runs edge to edge: a list whose rows carry their own padding. */
  flush?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className="centre-surface bg-card overflow-hidden rounded-2xl border" data-testid={testId}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", PASTEL[tone])}>
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-extrabold">
              {title}
              {count !== undefined && <SoftBadge tone={tone} className="tabular-nums">{count}</SoftBadge>}
            </h3>
            {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </header>
      <div className={flush ? undefined : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

/** One big number, the dashboard's stat card at the size a record's page wants. */
export function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  progress,
  barTone = "bg-primary",
  onClick,
  testId,
}: {
  icon: LucideIcon;
  tone: PastelTone;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** 0–100; draws the bar under the number. */
  progress?: number | null;
  barTone?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground/85 text-[0.8125rem] leading-snug font-bold sm:text-sm">{label}</p>
          <div className="mt-1 text-2xl leading-tight font-extrabold tabular-nums sm:text-[1.75rem]">{value}</div>
        </div>
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-12 sm:rounded-2xl", PASTEL[tone])}>
          <Icon className="size-5 sm:size-6" aria-hidden />
        </span>
      </div>
      {progress !== undefined && progress !== null && (
        <div className="bg-muted mt-2.5 h-1.5 overflow-hidden rounded-full">
          <div className={cn("h-full rounded-full transition-all", barTone)} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      {sub && <div className="text-muted-foreground mt-2 text-xs">{sub}</div>}
    </>
  );
  const shell = "centre-surface bg-card flex h-full w-full flex-col rounded-2xl border p-3.5 text-start sm:p-4";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(shell, "hover:border-primary/40 transition-colors")} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className={shell} data-testid={testId}>
      {body}
    </div>
  );
}

/** A person's initials on their own pastel: the same person is the same colour on every list. */
export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold", pastelFor(name), className)} aria-hidden>
      {initials}
    </span>
  );
}

/** A lesson's day as a little calendar leaf: the number big, the month under it. */
export function DateTile({ iso, timeZone, locale, tone }: { iso: string; timeZone: string; locale: string; tone: PastelTone }) {
  const date = new Date(iso);
  const tag = numeralLocale(locale);
  return (
    <span className={cn("flex size-14 shrink-0 flex-col items-center justify-center rounded-xl leading-none", PASTEL[tone])} aria-hidden>
      <span className="text-xl font-extrabold tabular-nums">{new Intl.DateTimeFormat(tag, { timeZone, day: "numeric" }).format(date)}</span>
      <span className="mt-1 text-[0.6875rem] font-bold">{new Intl.DateTimeFormat(tag, { timeZone, month: "short" }).format(date)}</span>
    </span>
  );
}

/** A rate as a pill: green from 90%, amber from 75%, red under that. `rate` is 0–1. */
export function rateTone(rate: number | null | undefined): PastelTone {
  if (rate === null || rate === undefined) return "slate";
  if (rate >= 0.9) return "emerald";
  if (rate >= 0.75) return "amber";
  return "rose";
}

/** The centre's tab strip: pills on one white card, the open one on the primary gradient. */
export function PillTabs<K extends string>({
  tabs,
  value,
  onChange,
  testIdPrefix,
}: {
  tabs: { key: K; label: ReactNode; icon?: LucideIcon; badge?: ReactNode; alert?: boolean }[];
  value: K;
  onChange: (key: K) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="centre-surface bg-card no-scrollbar flex gap-1 overflow-x-auto rounded-2xl border p-1.5" role="tablist">
      {tabs.map(({ key, label, icon: Icon, badge, alert }) => {
        const on = value === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(key)}
            className={cn(
              "focus-visible:ring-ring/50 inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-bold transition-colors outline-none focus-visible:ring-2",
              on ? "centre-button-primary" : alert ? "text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            data-testid={`${testIdPrefix}-${key}`}
          >
            {Icon && <Icon className="size-4" aria-hidden />}
            {label}
            {badge !== undefined && badge !== null && (
              <span className={cn("rounded-full px-1.5 text-xs font-bold tabular-nums", on ? "bg-white/20" : alert ? "bg-rose-500 text-white" : "bg-muted")}>{badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A clock-face time on a pastel block: the lessons board's row head. */
export function TimeTile({ children, tone, className }: { children: ReactNode; tone: PastelTone; className?: string }) {
  return (
    <span className={cn("flex h-14 w-16 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold tabular-nums", PASTEL[tone], className)} dir="ltr">
      {children}
    </span>
  );
}

/** The centre's empty state: a pastel icon, a line, and whatever the page offers to do about it. */
export function EmptyCard({ icon: Icon, tone = "violet", text, action, testId }: { icon: LucideIcon; tone?: PastelTone; text: string; action?: ReactNode; testId?: string }) {
  return (
    <div className="centre-surface bg-card flex flex-col items-center rounded-2xl border px-6 py-12 text-center" data-testid={testId}>
      <span className={cn("flex size-14 items-center justify-center rounded-2xl", PASTEL[tone])}>
        <Icon className="size-7" aria-hidden />
      </span>
      <p className="text-muted-foreground mt-4 text-sm font-medium">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
