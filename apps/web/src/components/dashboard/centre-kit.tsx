"use client";

import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { CountUp } from "@/components/dashboard/academy-dashboard";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The learning centre's dashboard pieces. Calmer than the Quran academy's StatCard on purpose: a
 * pastel icon tile and one big number, no stripes, glows or watermarks. Kept apart from
 * academy-dashboard.tsx so that screen stays exactly what it is.
 */
export type CentreTone = "violet" | "indigo" | "sky" | "emerald" | "amber" | "rose" | "slate";

const TONES: Record<CentreTone, string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
};

export const centrePanelClass = "bg-card rounded-2xl border p-4 shadow-sm sm:p-5";

export function CentreStat({
  Icon,
  tone,
  label,
  value,
  money,
  sub,
  progress,
  alert,
  loading,
  href,
  locale,
}: {
  Icon: LucideIcon;
  tone: CentreTone;
  label: string;
  /** null ⇒ "—": the figure could not be read, which is not the same as zero. */
  value?: number | null;
  /** Set instead of `value` for an amount. */
  money?: { amount: number; currency: string } | null;
  sub?: string;
  /** 0–100; draws a thin bar under the sub line. */
  progress?: number;
  alert?: boolean;
  loading: boolean;
  href?: string;
  locale: string;
}) {
  const inner = (
    <div
      className={cn(
        centrePanelClass,
        "h-full transition-shadow",
        href && "hover:shadow-md",
        alert && "border-amber-300 dark:border-amber-500/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-sm font-medium">{label}</p>
          {loading ? (
            <div className="bg-muted mt-2 h-8 w-20 animate-pulse rounded-lg" />
          ) : (
            <p className="mt-1 text-2xl font-bold tracking-tight break-words tabular-nums">
              {money ? (
                formatMoney({ amount: money.amount, currency: money.currency }, locale)
              ) : value === null || value === undefined ? (
                "—"
              ) : (
                <CountUp value={value} locale={locale} />
              )}
            </p>
          )}
        </div>
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      {!loading && sub && <p className="text-muted-foreground mt-2 text-xs">{sub}</p>}
      {!loading && progress !== undefined && (
        <div className="bg-muted mt-2.5 h-1.5 overflow-hidden rounded-full">
          <div className="bg-primary h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(progress, 100)}%` }} />
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

export function CentreSectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div>
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      {desc && <p className="text-muted-foreground mt-0.5 text-xs">{desc}</p>}
    </div>
  );
}

export function CentreAction({
  href,
  Icon,
  tone,
  label,
  desc,
  badge,
}: {
  href: string;
  Icon: LucideIcon;
  tone: CentreTone;
  label: string;
  desc: string;
  badge?: number;
}) {
  return (
    <Link href={href} className="bg-card group flex items-center gap-3 rounded-2xl border p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="text-muted-foreground truncate text-xs">{desc}</p>
      </div>
      {badge !== undefined && badge > 0 ? (
        <span className="bg-destructive flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : (
        <ArrowUpRight className="text-muted-foreground/50 size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
      )}
    </Link>
  );
}

/**
 * The month's collections as a running total, up to today. Real receipts only: the days come from
 * the accounting overview, and days still ahead are left off rather than drawn flat. Time runs left
 * to right in both languages, as on every chart in the product.
 */
export function CollectionsChart({
  days,
  today,
  currency,
  locale,
  title,
  sub,
  empty,
  href,
}: {
  days: { date: string; amount_minor: number }[];
  today: string;
  currency: string;
  locale: string;
  title: string;
  sub: string;
  empty: string;
  href: string;
}) {
  const shown = days.filter((d) => d.date <= today);
  let running = 0;
  const totals = shown.map((d) => (running += d.amount_minor));
  const total = totals[totals.length - 1] ?? 0;

  const W = 600;
  const H = 180;
  const pad = 10;
  const x = (i: number) => pad + (totals.length > 1 ? (i / (totals.length - 1)) * (W - pad * 2) : 0);
  const y = (v: number) => H - pad - (total > 0 ? (v / total) * (H - pad * 2) : 0);
  const line = totals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const dayLabel = (date: string) => formatNumber(Number(date.slice(8, 10)), locale);

  return (
    <div className={cn(centrePanelClass, "lg:col-span-2")} data-testid="collections-chart">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>
        </div>
        <Link href={href} className="text-lg font-bold tabular-nums hover:underline">
          {formatMoney({ amount: total, currency }, locale)}
        </Link>
      </div>
      {total === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">{empty}</p>
      ) : (
        <div dir="ltr" className="mt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" preserveAspectRatio="none" role="img" aria-label={title}>
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={pad} x2={W - pad} y1={H * f} y2={H * f} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={`${line} L${x(totals.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`} fill="var(--chart-1)" fillOpacity="0.1" />
            <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="text-muted-foreground mt-1 flex justify-between text-[11px] tabular-nums">
            <span>{dayLabel(shown[0]?.date ?? today)}</span>
            <span>{dayLabel(shown[shown.length - 1]?.date ?? today)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The week's sheets as a ring. Absent and excused are one slice here, as the rate counts them. */
export function AttendanceRing({
  rate,
  title,
  presentLabel,
  absentLabel,
  empty,
  locale,
  wide,
}: {
  rate: number | null;
  title: string;
  presentLabel: string;
  absentLabel: string;
  empty: string;
  locale: string;
  /** The whole row, when there is no chart beside it. */
  wide?: boolean;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;

  return (
    <div className={cn(centrePanelClass, wide && "lg:col-span-3")} data-testid="attendance-ring">
      <h3 className="text-sm font-bold">{title}</h3>
      {rate === null ? (
        <p className="text-muted-foreground py-12 text-center text-sm">{empty}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-5">
          <div className="relative size-36 shrink-0">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
              <circle cx="60" cy="60" r={r} fill="none" stroke="var(--muted)" strokeWidth="14" />
              <circle cx="60" cy="60" r={r} fill="none" stroke="var(--chart-1)" strokeWidth="14" strokeDasharray={`${rate * c} ${c}`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums">
              {`${formatNumber(Math.round(rate * 100), locale)}%`}
            </span>
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="bg-primary size-2.5 rounded-full" aria-hidden />
              {presentLabel}
            </li>
            <li className="flex items-center gap-2">
              <span className="bg-muted-foreground/30 size-2.5 rounded-full" aria-hidden />
              {absentLabel}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
