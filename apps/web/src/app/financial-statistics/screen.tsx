"use client";

import {
  ArrowRightLeft,
  BarChart3,
  Briefcase,
  CircleDollarSign,
  Clock,
  Coins,
  CreditCard,
  DollarSign,
  PieChart,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { InvoiceDetailModal } from "@/components/invoices/invoice-detail-modal";
import {
  apiFetch,
  getExchangeRates,
  getInvoiceSummary,
  getProfitSummary,
  listStaff,
  type ExchangeRates,
  type InvoiceSummary,
  type ListResult,
  type ProfitSummary,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Local types ────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  kind: "AUTO" | "MANUAL";
  payer_name: string;
  period_month: number;
  period_year: number;
  status: "OPEN" | "CLOSED" | "PAID" | "PARTIALLY_PAID";
  total_minor: number;
  amount_paid_minor: number;
  currency: string;
}

interface MonthlyPoint {
  month: number;
  revenue: number;
  payouts: number;
  profit: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MONTHS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

// ── SVG Bar Chart ──────────────────────────────────────────────────────────────

function MonthlyBarChart({
  data,
  locale,
}: {
  data: MonthlyPoint[];
  locale: string;
}) {
  const W = 360;
  const H = 160;
  const PT = 10;
  const PB = 26;
  const PL = 4;
  const PR = 4;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const maxVal = Math.max(...data.flatMap((d) => [d.revenue, d.payouts]), 1);
  const groupW = chartW / 12;
  const barW = Math.max(groupW * 0.3, 4);
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short" });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      aria-label="Monthly revenue and payouts chart"
    >
      {/* Horizontal grid lines */}
      {[0.25, 0.5, 0.75, 1].map((f) => {
        const y = PT + (1 - f) * chartH;
        return (
          <line
            key={f}
            x1={PL}
            y1={y}
            x2={PL + chartW}
            y2={y}
            stroke="currentColor"
            strokeOpacity={0.06}
            strokeWidth={0.75}
          />
        );
      })}

      {data.map((d, i) => {
        const gx = PL + i * groupW;
        const cx = gx + groupW / 2;
        const revH = d.revenue > 0 ? Math.max((d.revenue / maxVal) * chartH, 3) : 0;
        const payH = d.payouts > 0 ? Math.max((d.payouts / maxVal) * chartH, 3) : 0;
        const label = monthFmt.format(new Date(2024, d.month - 1, 1));

        return (
          <g key={i}>
            {/* Revenue bar */}
            <rect
              x={cx - barW - 1}
              y={PT + chartH - revH}
              width={barW}
              height={revH}
              rx={2}
              fill="var(--color-chart-1)"
              opacity={0.82}
            />
            {/* Payouts bar */}
            <rect
              x={cx + 1}
              y={PT + chartH - payH}
              width={barW}
              height={payH}
              rx={2}
              fill="var(--color-chart-2)"
              opacity={0.82}
            />
            {/* Month label */}
            <text
              x={cx}
              y={H - 7}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              fillOpacity={0.38}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── SVG Donut Chart ────────────────────────────────────────────────────────────

const DONUT_SEGMENTS = [
  { key: "PAID", color: "#22c55e" },
  { key: "OPEN", color: "#3b82f6" },
  { key: "CLOSED", color: "#f59e0b" },
  { key: "PARTIALLY_PAID", color: "#f97316" },
] as const;

function DonutChart({
  counts,
  t,
}: {
  counts: InvoiceSummary["counts"];
  t: ReturnType<typeof useTranslations>;
}) {
  const segments = DONUT_SEGMENTS.map((s) => ({
    ...s,
    value: counts[s.key as keyof typeof counts] as number,
  }));
  const total = counts.all;

  if (total === 0) {
    return (
      <div className="text-muted-foreground flex h-36 items-center justify-center text-sm">
        {t("empty")}
      </div>
    );
  }

  const SIZE = 110;
  const R = 44;
  const r = 28;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  let angle = -Math.PI / 2;

  const arcs = segments
    .filter((s) => s.value > 0)
    .map((seg) => {
      const sweep = (seg.value / total) * 2 * Math.PI;
      const end = angle + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const [cos1, sin1, cos2, sin2] = [
        Math.cos(angle),
        Math.sin(angle),
        Math.cos(end),
        Math.sin(end),
      ];
      const path = [
        `M ${CX + R * cos1} ${CY + R * sin1}`,
        `A ${R} ${R} 0 ${large} 1 ${CX + R * cos2} ${CY + R * sin2}`,
        `L ${CX + r * cos2} ${CY + r * sin2}`,
        `A ${r} ${r} 0 ${large} 0 ${CX + r * cos1} ${CY + r * sin1}`,
        "Z",
      ].join(" ");
      angle = end;
      return { path, color: seg.color, key: seg.key, value: seg.value };
    });

  return (
    <div className="flex items-center gap-5">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-28 shrink-0">
        {arcs.map((arc) => (
          <path key={arc.key} d={arc.path} fill={arc.color} />
        ))}
        <text
          x={CX}
          y={CY - 3}
          textAnchor="middle"
          fontSize={17}
          fontWeight="700"
          fill="currentColor"
        >
          {total}
        </text>
        <text
          x={CX}
          y={CY + 12}
          textAnchor="middle"
          fontSize={7}
          fill="currentColor"
          fillOpacity={0.42}
        >
          {t("summaryTotal")}
        </text>
      </svg>

      <div className="min-w-0 flex-1 space-y-2">
        {DONUT_SEGMENTS.map((seg) => {
          const val = counts[seg.key as keyof typeof counts] as number;
          const pct = total > 0 ? Math.round((val / total) * 100) : 0;
          return (
            <div key={seg.key} className="flex items-center gap-2 text-xs">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-muted-foreground min-w-0 flex-1 truncate">
                {t(`status.${seg.key}`)}
              </span>
              <span className="text-foreground font-semibold tabular-nums">
                {val}
              </span>
              <span
                className="w-8 text-end text-[0.7rem] font-medium tabular-nums"
                style={{ color: seg.color }}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Money Stack (multi-currency value) ──────────────────────────────────────────

interface MoneyEntry {
  currency: string;
  minor: number;
}

/** Renders one money line per currency. Falls back to "—" when empty. */
function MoneyStack({
  entries,
  locale,
}: {
  entries: MoneyEntry[];
  locale: string;
}) {
  if (entries.length === 0) return <>—</>;
  const multi = entries.length > 1;
  return (
    <span className="flex flex-col gap-0.5">
      {entries.map((e) => (
        <span key={e.currency} className={cn("truncate", multi && "text-lg")}>
          {formatMoney({ amount: e.minor, currency: e.currency }, locale)}
        </span>
      ))}
    </span>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

type KpiTone = "primary" | "emerald" | "amber" | "rose" | "blue" | "violet";

const TONE_ICON: Record<KpiTone, string> = {
  primary: "bg-primary/10 text-primary",
  emerald:
    "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
  amber:
    "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  violet:
    "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
};

const TONE_BAR: Record<KpiTone, string> = {
  primary: "bg-primary",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
};

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  progress,
  trend,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: KpiTone;
  label: string;
  value: React.ReactNode;
  sub?: string;
  progress?: number;
  trend?: "up" | "down";
}) {
  return (
    <div className="bg-card relative overflow-hidden rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.03] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[0.67rem] font-semibold uppercase tracking-wider">
            {label}
          </p>
          <div className="mt-1.5 flex items-start gap-1.5">
            <div className="min-w-0 text-2xl font-bold tracking-tight tabular-nums">
              {value}
            </div>
            {trend === "up" && (
              <TrendingUp
                className="mb-0.5 size-3.5 shrink-0 text-emerald-500"
                aria-hidden
              />
            )}
            {trend === "down" && (
              <TrendingDown
                className="mb-0.5 size-3.5 shrink-0 text-rose-500"
                aria-hidden
              />
            )}
          </div>
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            TONE_ICON[tone],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
      </div>

      {progress !== undefined ? (
        <div className="mt-3.5">
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700",
                TONE_BAR[tone],
              )}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        </div>
      ) : sub ? (
        <p className="text-muted-foreground mt-3 truncate text-xs">{sub}</p>
      ) : (
        <div className="mt-3 h-4" aria-hidden />
      )}
    </div>
  );
}

// ── Currency Breakdown Cards ───────────────────────────────────────────────────

function CurrencyBreakdown({
  money,
  locale,
  t,
}: {
  money: InvoiceSummary["money"];
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {money.map((bucket) => {
        const rate =
          bucket.billed_minor > 0
            ? Math.round(
                (bucket.collected_minor / bucket.billed_minor) * 100,
              )
            : 0;
        const fmt = (v: number) =>
          formatMoney({ amount: v, currency: bucket.currency }, locale);

        return (
          <div
            key={bucket.currency}
            className="bg-card relative overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]"
          >
            <div className="flex items-center justify-between">
              <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-widest">
                {bucket.currency}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("currency.collected_pct", { rate })}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1 text-center">
              {(
                [
                  {
                    key: "billed" as const,
                    val: bucket.billed_minor,
                    cls: "",
                  },
                  {
                    key: "collected" as const,
                    val: bucket.collected_minor,
                    cls: "text-emerald-600 dark:text-emerald-400",
                  },
                  {
                    key: "outstanding" as const,
                    val: bucket.outstanding_minor,
                    cls:
                      bucket.outstanding_minor > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                  },
                ] as const
              ).map(({ key, val, cls }) => (
                <div key={key}>
                  <p className="text-muted-foreground text-[0.62rem] font-medium uppercase tracking-wide">
                    {t(`currency.${key}`)}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-sm font-bold tabular-nums",
                      cls,
                    )}
                  >
                    {fmt(val)}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <div className="bg-muted h-1 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                  style={{ width: `${rate}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Outstanding Dues Cards (all-time, per currency) ─────────────────────────────

/**
 * One card per currency showing the total amount still owed "until now" — the unpaid
 * portion of every CLOSED / PARTIALLY_PAID invoice across all periods. Fed by an
 * unfiltered invoice summary, so it is independent of the selected month.
 */
function DueCards({
  money,
  locale,
  t,
}: {
  money: InvoiceSummary["money"];
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (money.length === 0) {
    return (
      <div className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
        {t("section.duesEmpty")}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {money.map((bucket) => {
        const fmt = (v: number) =>
          formatMoney({ amount: v, currency: bucket.currency }, locale);
        const hasDue = bucket.due_minor > 0;

        return (
          <div
            key={bucket.currency}
            className="bg-card relative overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]"
          >
            <div className="flex items-center justify-between">
              <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-widest">
                {bucket.currency}
              </span>
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl",
                  hasDue
                    ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
                )}
              >
                <Clock className="size-4.5" aria-hidden />
              </span>
            </div>

            <p className="text-muted-foreground mt-3 text-[0.67rem] font-semibold uppercase tracking-wider">
              {t("section.dueLabel")}
            </p>
            <p
              className={cn(
                "mt-1 text-2xl font-bold tracking-tight tabular-nums",
                hasDue
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {fmt(bucket.due_minor)}
            </p>
            <p className="text-muted-foreground mt-2 truncate text-xs">
              {hasDue
                ? t("section.dueOfBilled", { billed: fmt(bucket.billed_minor) })
                : t("section.dueSettled")}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Profit Breakdown Cards ─────────────────────────────────────────────────────

function ProfitBreakdown({
  summary,
  staffSalaries,
  locale,
  t,
}: {
  summary: ProfitSummary | null;
  staffSalaries: Record<string, number>;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!summary || summary.rows.length === 0) {
    return (
      <div className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
        {t("profit.empty")}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {summary.rows.map((row) => {
        const salaries = staffSalaries[row.currency] ?? 0;
        const trueProfit = row.profit_minor - salaries;
        const positive = trueProfit >= 0;
        const margin =
          row.revenue_minor > 0
            ? Math.abs(Math.round((trueProfit / row.revenue_minor) * 100))
            : 0;
        const fmt = (v: number) =>
          formatMoney({ amount: v, currency: row.currency }, locale);

        return (
          <div
            key={row.currency}
            className="bg-card relative overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]"
          >
            {/* Subtle background gradient based on profit direction */}
            <div
              className={cn(
                "absolute inset-0 opacity-[0.04]",
                positive
                  ? "bg-gradient-to-br from-emerald-500 to-transparent"
                  : "bg-gradient-to-br from-rose-500 to-transparent",
              )}
              aria-hidden
            />

            <div className="relative flex items-center justify-between">
              <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-widest">
                {row.currency}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-semibold",
                  positive
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                )}
              >
                {positive ? (
                  <TrendingUp className="size-3" aria-hidden />
                ) : (
                  <TrendingDown className="size-3" aria-hidden />
                )}
                {t("profit.margin", { margin })}
              </span>
            </div>

            <div className="relative mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("profit.revenue")}</span>
                <span className="font-semibold tabular-nums">
                  {fmt(row.revenue_minor)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("profit.payouts")}</span>
                <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  − {fmt(row.payouts_minor)}
                </span>
              </div>
              {salaries > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t("profit.staffSalaries")}</span>
                  <span className="font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                    − {fmt(salaries)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-2 text-sm">
                <span className="font-semibold">
                  {salaries > 0 ? t("profit.trueNet") : t("profit.net")}
                </span>
                <span
                  className={cn(
                    "font-bold tabular-nums",
                    positive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {fmt(trueProfit)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Currency conversion (live FX → home currency) ───────────────────────────────

/**
 * Convert a set of per-currency minor amounts into a single home-currency minor total using live
 * rates. Same-currency entries pass through 1:1. Currencies with no live rate are reported in
 * `missing` so the UI can warn that the converted total excludes them.
 */
function convertToHome(
  entries: MoneyEntry[],
  rateMap: Record<string, number>,
  home: string,
): { minor: number; missing: string[] } {
  let minor = 0;
  const missing = new Set<string>();
  for (const e of entries) {
    if (e.minor === 0) continue;
    const rate = e.currency === home ? 1 : rateMap[e.currency];
    if (rate == null) {
      missing.add(e.currency);
      continue;
    }
    minor += Math.round(e.minor * rate);
  }
  return { minor, missing: Array.from(missing) };
}

/** Live conversion-rate list (owner only): how many home-currency units one foreign unit buys. */
function ConversionRates({
  fx,
  locale,
  t,
}: {
  fx: ExchangeRates;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const asOf = fx.as_of
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(fx.as_of * 1000))
    : null;

  if (fx.rates.length === 0) {
    return (
      <div className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
        {t("fx.unavailable")}
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.03]">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fx.rates.map((r) => (
          <div
            key={r.currency}
            className="flex items-center justify-between rounded-xl border bg-background/40 px-3 py-2.5"
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tracking-widest">
                {r.currency}
              </span>
              <ArrowRightLeft className="text-muted-foreground size-3.5" aria-hidden />
              <span className="text-muted-foreground text-xs font-bold tracking-widest">
                {fx.home}
              </span>
            </span>
            <span className="text-foreground font-bold tabular-nums">
              {nf.format(r.to_home)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-3 flex flex-wrap items-center gap-1.5 text-[0.7rem]">
        <Coins className="size-3 shrink-0" aria-hidden />
        {fx.stale
          ? t("fx.stale")
          : asOf
            ? t("fx.asOf", { time: asOf })
            : t("fx.live")}
        {fx.source ? ` · ${fx.source}` : ""}
      </p>
    </div>
  );
}

/** Converted-to-home summary: every currency rolled into one EGP total, salaries deducted in EGP. */
function ConvertedSummary({
  home,
  revenue,
  payouts,
  salaries,
  net,
  missing,
  locale,
  t,
}: {
  home: string;
  revenue: number;
  payouts: number;
  salaries: number;
  net: number;
  missing: string[];
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const fmt = (v: number) => formatMoney({ amount: v, currency: home }, locale);
  const positive = net >= 0;
  const margin =
    revenue > 0 ? Math.abs(Math.round((net / revenue) * 100)) : 0;

  const rows = [
    { key: "revenue", val: revenue, cls: "text-emerald-600 dark:text-emerald-400", sign: "" },
    { key: "payouts", val: payouts, cls: "text-amber-600 dark:text-amber-400", sign: "− " },
    { key: "salaries", val: salaries, cls: "text-violet-600 dark:text-violet-400", sign: "− " },
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Net profit headline */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]",
          positive
            ? "bg-emerald-50/60 dark:bg-emerald-950/20"
            : "bg-rose-50/60 dark:bg-rose-950/20",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-widest">
            {home}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-semibold",
              positive
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            {positive ? (
              <TrendingUp className="size-3" aria-hidden />
            ) : (
              <TrendingDown className="size-3" aria-hidden />
            )}
            {t("profit.margin", { margin })}
          </span>
        </div>
        <p className="text-muted-foreground mt-3 text-[0.67rem] font-semibold uppercase tracking-wider">
          {t("fx.netLabel")}
        </p>
        <p
          className={cn(
            "mt-1 text-3xl font-bold tracking-tight tabular-nums",
            positive
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400",
          )}
        >
          {fmt(net)}
        </p>
        <p className="text-muted-foreground mt-2 text-xs">{t("fx.netHint")}</p>
      </div>

      {/* Breakdown */}
      <div className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04] lg:col-span-2">
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-muted-foreground">{t(`fx.${r.key}`)}</span>
              <span className={cn("font-semibold tabular-nums", r.cls)}>
                {r.sign}
                {fmt(r.val)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t pt-2.5 text-sm">
            <span className="font-semibold">{t("fx.netLabel")}</span>
            <span
              className={cn(
                "font-bold tabular-nums",
                positive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {fmt(net)}
            </span>
          </div>
        </div>
        {missing.length > 0 && (
          <p className="text-amber-600 dark:text-amber-400 mt-3 text-[0.7rem]">
            {t("fx.missing", { currencies: missing.join(", ") })}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Recent Invoices ────────────────────────────────────────────────────────────

const INV_STATUS_CLS: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  CLOSED:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  PARTIALLY_PAID:
    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
};

const INV_STATUS_DOT: Record<string, string> = {
  OPEN: "bg-blue-500",
  CLOSED: "bg-amber-500",
  PAID: "bg-emerald-500",
  PARTIALLY_PAID: "bg-orange-500",
};

function RecentInvoices({
  invoices,
  locale,
  onSelect,
  tInv,
  t,
}: {
  invoices: InvoiceRow[];
  locale: string;
  onSelect: (id: string) => void;
  tInv: ReturnType<typeof useTranslations>;
  t: ReturnType<typeof useTranslations>;
}) {
  const monthFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
  });

  if (invoices.length === 0) {
    return (
      <div className="text-muted-foreground py-10 text-center text-sm">
        {tInv("empty")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {(
              ["payer", "period", "type", "status", "amount"] as const
            ).map((col) => (
              <th
                key={col}
                className={cn(
                  "text-muted-foreground pb-3 text-xs font-semibold uppercase tracking-wide",
                  col === "amount" ? "text-end" : "text-start",
                )}
              >
                {t(`section.${col}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {invoices.map((inv) => {
            const due = Math.max(0, inv.total_minor - inv.amount_paid_minor);
            return (
              <tr
                key={inv.id}
                className="hover:bg-muted/40 cursor-pointer transition-colors"
                onClick={() => onSelect(inv.id)}
              >
                <td className="py-3 pe-4">
                  <span className="font-medium">{inv.payer_name}</span>
                </td>
                <td className="text-muted-foreground py-3 pe-4 tabular-nums">
                  {monthFmt.format(
                    new Date(inv.period_year, inv.period_month - 1, 1),
                  )}
                </td>
                <td className="py-3 pe-4">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      inv.kind === "AUTO"
                        ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-950/40 dark:text-slate-300",
                    )}
                  >
                    {t(inv.kind === "AUTO" ? "section.auto" : "section.manual")}
                  </span>
                </td>
                <td className="py-3 pe-4">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                      INV_STATUS_CLS[inv.status] ?? "",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        INV_STATUS_DOT[inv.status] ?? "",
                      )}
                      aria-hidden
                    />
                    {tInv(`status.${inv.status}`)}
                  </span>
                </td>
                <td className="py-3 text-end">
                  <div className="flex flex-col items-end">
                    <span className="font-semibold tabular-nums">
                      {formatMoney(
                        { amount: inv.total_minor, currency: inv.currency },
                        locale,
                      )}
                    </span>
                    {inv.status === "PAID" ? (
                      <span className="text-[0.65rem] font-medium text-emerald-600 dark:text-emerald-400">
                        {tInv("paidInFull")}
                      </span>
                    ) : due > 0 &&
                      (inv.status === "CLOSED" ||
                        inv.status === "PARTIALLY_PAID") ? (
                      <span className="text-[0.65rem] font-medium tabular-nums text-amber-600 dark:text-amber-400">
                        {tInv("dueAmount", {
                          amount: formatMoney(
                            { amount: due, currency: inv.currency },
                            locale,
                          ),
                        })}
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="bg-primary/8 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" aria-hidden />
      </div>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && (
          <p className="text-muted-foreground text-[0.72rem]">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ── Skeleton loader ────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("bg-muted animate-pulse rounded-2xl", className)}
      aria-hidden
    />
  );
}

// ── Shared input style ─────────────────────────────────────────────────────────

const SEL =
  "border-input bg-background focus:border-primary focus:ring-primary/15 h-9 rounded-xl border px-3 text-sm outline-none transition-colors focus:ring-3";

// ── Main Screen ────────────────────────────────────────────────────────────────

export function FinancialStatisticsScreen() {
  const t = useTranslations("financialStats");
  const tInv = useTranslations("invoices");
  const locale = useLocale();
  const { can, session } = useAuth();
  const isOwner = session?.role === "ACADEMY_OWNER";

  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));

  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [staffSalaries, setStaffSalaries] = useState<Record<string, number>>({});
  const [activeStaffCount, setActiveStaffCount] = useState(0);
  const [dueMoney, setDueMoney] = useState<InvoiceSummary["money"]>([]);
  const [fx, setFx] = useState<ExchangeRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refreshAll = useCallback(
    (yr: string, mo: string) => {
      let cancelled = false;
      setLoading(true);

      const yNum = Number(yr);
      const mNum = Number(mo);

      Promise.all([
        // 1. Invoice summary for the selected period
        getInvoiceSummary({ period_year: yr, period_month: mo }).catch(
          () =>
            ({
              counts: { all: 0, OPEN: 0, CLOSED: 0, PAID: 0, PARTIALLY_PAID: 0 },
              money: [],
            }) as InvoiceSummary,
        ),
        // 2. Profit summary for the selected month
        getProfitSummary(yNum, mNum).catch(
          () => ({ year: yNum, month: mNum, rows: [] }) as ProfitSummary,
        ),
        // 3. 12 months of profit data for the bar chart (full year)
        Promise.all(
          MONTHS_12.map((m) =>
            getProfitSummary(yNum, m).catch(() => null),
          ),
        ),
        // 4. Recent invoices for selected year
        apiFetch<ListResult<InvoiceRow>>(
          `/api/invoices?pageSize=10&sort=-period&filter[period_year]=${yr}`,
        ).catch(
          () =>
            ({ rows: [], total: 0, page: 1, pageSize: 10 }) as ListResult<InvoiceRow>,
        ),
        // 5. Active staff — aggregate monthly salary by currency
        listStaff({ pageSize: 500, filter: { status: "active" } }).catch(
          () => ({ rows: [], total: 0, page: 1, pageSize: 500 }),
        ),
        // 6. All-time invoice summary (no period filter) — dues owed "until now"
        getInvoiceSummary({}).catch(
          () =>
            ({
              counts: { all: 0, OPEN: 0, CLOSED: 0, PAID: 0, PARTIALLY_PAID: 0 },
              money: [],
            }) as InvoiceSummary,
        ),
        // 7. Live FX rates (owner only) — converts every currency into the home currency.
        isOwner ? getExchangeRates().catch(() => null) : Promise.resolve(null),
      ]).then(([inv, pft, monthlyArr, recent, staffData, allTime, fxRates]) => {
        if (cancelled) return;
        setSummary(inv);
        setProfit(pft);
        setInvoices(recent.rows);
        setDueMoney(allTime.money);
        setFx(fxRates);

        // Aggregate staff salaries by currency
        const salaryByCurrency: Record<string, number> = {};
        for (const member of staffData.rows) {
          if (member.salary_minor > 0 && member.currency) {
            salaryByCurrency[member.currency] =
              (salaryByCurrency[member.currency] ?? 0) + member.salary_minor;
          }
        }
        setStaffSalaries(salaryByCurrency);
        setActiveStaffCount(staffData.total);

        // Pick primary currency from profit data or invoice summary
        const primaryCur =
          pft.rows[0]?.currency ?? inv.money[0]?.currency ?? null;

        setMonthly(
          MONTHS_12.map((m, i) => {
            const ps = monthlyArr[i];
            const row =
              ps?.rows.find((r) => r.currency === primaryCur) ??
              ps?.rows[0] ??
              null;
            return {
              month: m,
              revenue: row?.revenue_minor ?? 0,
              payouts: row?.payouts_minor ?? 0,
              profit: row?.profit_minor ?? 0,
            };
          }),
        );

        setLoading(false);
      });

      return () => {
        cancelled = true;
      };
    },
    [isOwner],
  );

  useEffect(() => {
    const cleanup = refreshAll(year, month);
    return cleanup;
  }, [year, month, refreshAll]);

  if (!can("invoice.read")) {
    return (
      <p className="text-muted-foreground text-sm">{t("noPermission")}</p>
    );
  }

  // ── Derived values (multi-currency) ──────────────────────────────────────────
  const moneyBuckets = summary?.money ?? [];
  const profitRows = profit?.rows ?? [];

  // Per-currency entries for each money KPI.
  const revenueEntries = moneyBuckets.map((b) => ({
    currency: b.currency,
    minor: b.billed_minor,
  }));
  const collectedEntries = moneyBuckets.map((b) => ({
    currency: b.currency,
    minor: b.collected_minor,
  }));
  const outstandingEntries = moneyBuckets.map((b) => ({
    currency: b.currency,
    minor: b.outstanding_minor,
  }));
  const payoutEntries = profitRows.map((r) => ({
    currency: r.currency,
    minor: r.payouts_minor,
  }));
  const salaryEntries = Object.entries(staffSalaries).map(([currency, minor]) => ({
    currency,
    minor,
  }));

  // Collection rate per currency.
  const rateEntries = moneyBuckets.map((b) => ({
    currency: b.currency,
    rate:
      b.billed_minor > 0
        ? Math.round((b.collected_minor / b.billed_minor) * 100)
        : 0,
  }));

  // Net profit & total expenses span every currency seen in payouts or salaries.
  const expenseCurrencies = Array.from(
    new Set([...profitRows.map((r) => r.currency), ...Object.keys(staffSalaries)]),
  );
  const netProfitEntries = expenseCurrencies.map((currency) => {
    const row = profitRows.find((r) => r.currency === currency);
    return {
      currency,
      minor: (row?.profit_minor ?? 0) - (staffSalaries[currency] ?? 0),
    };
  });
  const totalExpenseEntries = expenseCurrencies.map((currency) => {
    const row = profitRows.find((r) => r.currency === currency);
    return {
      currency,
      minor: (row?.payouts_minor ?? 0) + (staffSalaries[currency] ?? 0),
    };
  });
  const allNetPositive = netProfitEntries.every((e) => e.minor >= 0);

  // ── Converted-to-home totals (owner, live FX) ────────────────────────────────
  // Roll every currency into the academy home currency (EGP) so the owner reads one number, and
  // compute the net after deducting teacher payouts AND staff salaries — all in EGP.
  const homeCur = fx?.home ?? "EGP";
  const rateMap: Record<string, number> = {};
  for (const r of fx?.rates ?? []) rateMap[r.currency] = r.to_home;

  const convRevenue = convertToHome(collectedEntries, rateMap, homeCur);
  const convPayouts = convertToHome(payoutEntries, rateMap, homeCur);
  const convSalaries = convertToHome(salaryEntries, rateMap, homeCur);
  const convNet =
    convRevenue.minor - convPayouts.minor - convSalaries.minor;
  const convMissing = Array.from(
    new Set([
      ...convRevenue.missing,
      ...convPayouts.missing,
      ...convSalaries.missing,
    ]),
  );
  const showConverted =
    isOwner &&
    !!fx &&
    (collectedEntries.length > 0 ||
      payoutEntries.length > 0 ||
      salaryEntries.length > 0);

  const pctFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(new Date(Number(year), Number(month) - 1, 1));

  const hasChartData = monthly.some((d) => d.revenue > 0 || d.payouts > 0);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
        </div>

        {/* Period selectors */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className={SEL}
          >
            {YEARS.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
          <select
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={SEL}
          >
            {MONTHS_12.map((m) => {
              const lbl = new Intl.DateTimeFormat(locale, {
                month: "long",
              }).format(new Date(2024, m - 1, 1));
              return (
                <option key={m} value={String(m)}>
                  {lbl}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 border shadow-sm" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* Row 1 — Income */}
          <KpiCard
            icon={Receipt}
            tone="primary"
            label={t("kpi.revenue")}
            value={<MoneyStack entries={revenueEntries} locale={locale} />}
            sub={`${summary?.counts.all ?? 0} ${t("kpi.invoices")}`}
          />
          <KpiCard
            icon={Wallet}
            tone="emerald"
            label={t("kpi.collected")}
            value={<MoneyStack entries={collectedEntries} locale={locale} />}
            sub={`${summary?.counts.PAID ?? 0} ${t("kpi.paid")}`}
            trend={
              collectedEntries.some((e) => e.minor > 0) ? "up" : undefined
            }
          />
          <KpiCard
            icon={Clock}
            tone="amber"
            label={t("kpi.outstanding")}
            value={<MoneyStack entries={outstandingEntries} locale={locale} />}
            sub={`${(summary?.counts.CLOSED ?? 0) + (summary?.counts.PARTIALLY_PAID ?? 0)} ${t("kpi.awaiting")}`}
            trend={
              outstandingEntries.some((e) => e.minor > 0) ? "down" : undefined
            }
          />
          <KpiCard
            icon={BarChart3}
            tone="blue"
            label={t("kpi.collectionRate")}
            value={
              rateEntries.length === 0 ? (
                "—"
              ) : rateEntries.length === 1 ? (
                `${pctFmt.format(rateEntries[0]?.rate ?? 0)}%`
              ) : (
                <span className="flex flex-col gap-0.5">
                  {rateEntries.map((r) => (
                    <span key={r.currency} className="text-lg">
                      <span className="text-muted-foreground mr-1 text-xs font-semibold tracking-widest">
                        {r.currency}
                      </span>
                      {pctFmt.format(r.rate)}%
                    </span>
                  ))}
                </span>
              )
            }
            progress={
              rateEntries.length === 1 ? (rateEntries[0]?.rate ?? 0) : undefined
            }
          />
          {/* Row 2 — Expenses & profit */}
          <KpiCard
            icon={DollarSign}
            tone="violet"
            label={t("kpi.payouts")}
            value={<MoneyStack entries={payoutEntries} locale={locale} />}
            sub={monthLabel}
          />
          <KpiCard
            icon={Briefcase}
            tone="rose"
            label={t("kpi.staffSalaries")}
            value={<MoneyStack entries={salaryEntries} locale={locale} />}
            sub={`${activeStaffCount} ${t("kpi.activeStaff")}`}
          />
          <KpiCard
            icon={CircleDollarSign}
            tone={allNetPositive ? "emerald" : "rose"}
            label={t("kpi.netProfit")}
            value={<MoneyStack entries={netProfitEntries} locale={locale} />}
            sub={monthLabel}
            trend={
              netProfitEntries.length === 0
                ? undefined
                : allNetPositive
                  ? "up"
                  : "down"
            }
          />
          <KpiCard
            icon={TrendingDown}
            tone="amber"
            label={t("kpi.totalExpenses")}
            value={<MoneyStack entries={totalExpenseEntries} locale={locale} />}
            sub={monthLabel}
          />
        </div>
      )}

      {/* ── Charts row ────────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-5">
        {/* Monthly bar chart — 3 of 5 cols */}
        <div className="bg-card xl:col-span-3 rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.03]">
          <SectionHeader
            icon={BarChart3}
            title={t("chart.monthlyTitle")}
            sub={t("chart.monthlyHint", { year })}
          />

          <div className="mt-5">
            {loading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : !hasChartData ? (
              <div className="text-muted-foreground flex h-40 items-center justify-center rounded-xl border border-dashed text-sm">
                {t("chart.noData")}
              </div>
            ) : (
              <>
                <MonthlyBarChart data={monthly} locale={locale} />
                {/* Legend */}
                <div className="mt-3 flex items-center justify-center gap-5">
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span className="size-2.5 rounded-sm bg-[var(--color-chart-1)]" />
                    {t("chart.revenue")}
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span className="size-2.5 rounded-sm bg-[var(--color-chart-2)]" />
                    {t("chart.payouts")}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Status donut — 2 of 5 cols */}
        <div className="bg-card xl:col-span-2 rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.03]">
          <SectionHeader
            icon={PieChart}
            title={t("chart.statusTitle")}
            sub={monthLabel}
          />

          <div className="mt-5">
            {loading ? (
              <Skeleton className="h-32 rounded-xl" />
            ) : (
              <DonutChart
                counts={
                  summary?.counts ?? {
                    all: 0,
                    OPEN: 0,
                    CLOSED: 0,
                    PAID: 0,
                    PARTIALLY_PAID: 0,
                  }
                }
                t={tInv}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Currency breakdown ─────────────────────────────────────────────── */}
      {!loading && (summary?.money.length ?? 0) > 0 && (
        <section className="space-y-3">
          <SectionHeader
            icon={CreditCard}
            title={t("section.currencies")}
            sub={t("section.currenciesHint")}
          />
          <CurrencyBreakdown
            money={summary!.money}
            locale={locale}
            t={t}
          />
        </section>
      )}

      {/* ── Converted to home currency (owner, live FX) ────────────────────── */}
      {isOwner && (
        <section className="space-y-3">
          <SectionHeader
            icon={Coins}
            title={t("fx.convertedTitle", { home: homeCur })}
            sub={t("fx.convertedHint", { home: homeCur })}
          />
          {loading ? (
            <Skeleton className="h-32 border shadow-sm" />
          ) : showConverted ? (
            <ConvertedSummary
              home={homeCur}
              revenue={convRevenue.minor}
              payouts={convPayouts.minor}
              salaries={convSalaries.minor}
              net={convNet}
              missing={convMissing}
              locale={locale}
              t={t}
            />
          ) : (
            <div className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
              {fx ? t("profit.empty") : t("fx.unavailable")}
            </div>
          )}
        </section>
      )}

      {/* ── Live conversion rates (owner) ──────────────────────────────────── */}
      {isOwner && (
        <section className="space-y-3">
          <SectionHeader
            icon={ArrowRightLeft}
            title={t("fx.ratesTitle")}
            sub={t("fx.ratesHint", { home: homeCur })}
          />
          {loading ? (
            <Skeleton className="h-32 border shadow-sm" />
          ) : fx ? (
            <ConversionRates fx={fx} locale={locale} t={t} />
          ) : (
            <div className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
              {t("fx.unavailable")}
            </div>
          )}
        </section>
      )}

      {/* ── Outstanding dues (all-time, per currency) ──────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={Clock}
          title={t("section.dues")}
          sub={t("section.duesHint")}
        />
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 border shadow-sm" />
            ))}
          </div>
        ) : (
          <DueCards money={dueMoney} locale={locale} t={t} />
        )}
      </section>

      {/* ── Profit breakdown ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={TrendingUp}
          title={t("section.profit")}
          sub={`${t("section.profitHint")} · ${monthLabel}`}
        />
        {Object.keys(staffSalaries).length > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Briefcase className="size-3 shrink-0" aria-hidden />
            {t("section.staffSalariesIncluded")}
          </p>
        )}
        {loading ? (
          <Skeleton className="h-28 border shadow-sm" />
        ) : (
          <ProfitBreakdown summary={profit} staffSalaries={staffSalaries} locale={locale} t={t} />
        )}
      </section>

      {/* ── Manual / recent invoices ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionHeader
            icon={Receipt}
            title={t("section.recentInvoices")}
            sub={t("section.recentHint")}
          />
          <Link
            href="/invoices"
            className="text-primary hover:text-primary/80 text-xs font-medium transition-colors"
          >
            {t("section.viewAll")} →
          </Link>
        </div>

        <div className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.03]">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 rounded-lg" />
              ))}
            </div>
          ) : (
            <RecentInvoices
              invoices={invoices}
              locale={locale}
              onSelect={setSelectedId}
              tInv={tInv}
              t={t}
            />
          )}
        </div>
      </section>

      {/* Invoice detail modal */}
      <InvoiceDetailModal
        invoiceId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
