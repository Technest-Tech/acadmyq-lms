"use client";

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FlaskConical,
  GraduationCap,
  LayoutDashboard,
  Minus,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SubscriptionBanner } from "@/components/dashboard/subscription-banner";
import {
  getCalendar,
  getEntitlements,
  getInvoiceSummary,
  getPendingAttendance,
  getProfitSummary,
  listMyPayouts,
  listStudents,
  listTeachers,
  type CalendarSession,
  type Entitlements,
  type InvoiceSummary,
  type PendingSession,
  type ProfitSummary,
  type ProfitSummaryRow,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Date helpers ───────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getLast6Months(): { year: number; month: number }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

function getCurrentWeek(): { from: string; to: string } {
  const today = new Date();
  const dow = today.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + offset);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: isoDate(mon), to: isoDate(sun) };
}

// ── Skeleton / Spinner ─────────────────────────────────────────────────────────

function Sk({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

function Spin({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Animated count-up ──────────────────────────────────────────────────────────

function CountUp({ value, locale }: { value: number; locale: string }) {
  const [displayed, setDisplayed] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const start = 0;
    const end = value;
    const duration = 800;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(start + (end - start) * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value]);

  return <span>{formatNumber(displayed, locale)}</span>;
}

// ── SVG: Mini area sparkline ───────────────────────────────────────────────────

function Sparkline({
  data,
  color,
  className,
}: {
  data: number[];
  color: string;
  className?: string;
}) {
  if (data.length < 2) return null;
  const W = 80;
  const H = 28;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    H - ((v - min) / range) * (H - 4) - 2,
  ]);
  const linePath = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#sg-${color.replace("#", "")})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── SVG: Revenue vs Payouts grouped bar chart ──────────────────────────────────

interface MonthPoint {
  year: number;
  month: number;
  revenue: number;
  payouts: number;
}

function RevenueBarChart({ data, locale }: { data: MonthPoint[]; locale: string }) {
  const W = 400;
  const H = 180;
  const PT = 12;
  const PB = 28;
  const PL = 8;
  const PR = 8;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const maxVal = Math.max(...data.flatMap((d) => [d.revenue, d.payouts]), 1);
  const groupW = chartW / data.length;
  const barW = Math.max(groupW * 0.28, 5);
  const monthFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-arab" : locale, { month: "short" });
  const bcp47 = locale.startsWith("ar") ? "ar-u-nu-arab" : locale;
  function shortVal(v: number): string {
    if (v >= 100_000) return new Intl.NumberFormat(bcp47, { notation: "compact", maximumFractionDigits: 0 }).format(v / 100);
    if (v >= 1_000) return new Intl.NumberFormat(bcp47, { notation: "compact", maximumFractionDigits: 1 }).format(v / 100);
    return new Intl.NumberFormat(bcp47, { maximumFractionDigits: 0 }).format(v / 100);
  }

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-label="Revenue vs payouts chart">
        {/* Grid */}
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = PT + (1 - f) * chartH;
          return (
            <g key={f}>
              <line x1={PL} y1={y} x2={PL + chartW} y2={y} stroke="currentColor" strokeOpacity={0.07} strokeWidth={0.75} strokeDasharray="3 3" />
              <text x={PL} y={y - 2} fontSize={7} fill="currentColor" fillOpacity={0.3} textAnchor="start">
                {shortVal(Math.round(maxVal * f))}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const gx = PL + i * groupW;
          const cx = gx + groupW / 2;
          const revH = d.revenue > 0 ? Math.max((d.revenue / maxVal) * chartH, 3) : 0;
          const payH = d.payouts > 0 ? Math.max((d.payouts / maxVal) * chartH, 3) : 0;
          const label = monthFmt.format(new Date(d.year, d.month - 1, 1));
          const isCurrent = i === data.length - 1;

          return (
            <g key={i}>
              <rect x={cx - barW - 1.5} y={PT + chartH - revH} width={barW} height={revH} rx={2.5} fill="#10b981" opacity={isCurrent ? 1 : 0.7} />
              <rect x={cx + 1.5} y={PT + chartH - payH} width={barW} height={payH} rx={2.5} fill="#f43f5e" opacity={isCurrent ? 1 : 0.7} />
              <text x={cx} y={H - 10} textAnchor="middle" fontSize={8} fill="currentColor" fillOpacity={isCurrent ? 0.7 : 0.38} fontWeight={isCurrent ? "600" : "400"}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center gap-5 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500" />
          Payouts
        </span>
      </div>
    </>
  );
}

// ── SVG: Invoice donut chart ───────────────────────────────────────────────────

const DONUT_SEG = [
  { key: "PAID" as const, color: "#22c55e", label: "Paid" },
  { key: "OPEN" as const, color: "#3b82f6", label: "Open" },
  { key: "CLOSED" as const, color: "#f59e0b", label: "Closed" },
  { key: "PARTIALLY_PAID" as const, color: "#f97316", label: "Partial" },
];

function InvoiceDonut({ counts, locale }: { counts: InvoiceSummary["counts"]; locale: string }) {
  const total = counts.all;
  const SIZE = 120;
  const R = 50;
  const r = 32;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  let angle = -Math.PI / 2;

  if (total === 0) {
    return (
      <div className="flex h-28 items-center justify-center">
        <p className="text-xs text-muted-foreground">No invoices yet</p>
      </div>
    );
  }

  const arcs = DONUT_SEG.filter((s) => counts[s.key] > 0).map((seg) => {
    const sweep = (counts[seg.key] / total) * 2 * Math.PI;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const [c1, s1, c2, s2] = [Math.cos(angle), Math.sin(angle), Math.cos(end), Math.sin(end)];
    const path = [
      `M ${CX + R * c1} ${CY + R * s1}`,
      `A ${R} ${R} 0 ${large} 1 ${CX + R * c2} ${CY + R * s2}`,
      `L ${CX + r * c2} ${CY + r * s2}`,
      `A ${r} ${r} 0 ${large} 0 ${CX + r * c1} ${CY + r * s1}`,
      "Z",
    ].join(" ");
    angle = end;
    return { ...seg, path, value: counts[seg.key] };
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-28 shrink-0">
        {arcs.map((a) => <path key={a.key} d={a.path} fill={a.color} />)}
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize={18} fontWeight="700" fill="currentColor">{formatNumber(total, locale)}</text>
        <text x={CX} y={CY + 11} textAnchor="middle" fontSize={7.5} fill="currentColor" fillOpacity={0.4}>total</text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        {DONUT_SEG.map((seg) => {
          const val = counts[seg.key];
          const pct = total > 0 ? Math.round((val / total) * 100) : 0;
          return (
            <div key={seg.key} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{seg.label}</span>
              <span className="font-semibold tabular-nums">{formatNumber(val, locale)}</span>
              <span className="w-8 text-end text-[0.68rem] font-medium tabular-nums" style={{ color: seg.color }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── SVG: Collection rate gauge ─────────────────────────────────────────────────

function CollectionGauge({ rate }: { rate: number }) {
  const R = 42;
  const CX = 55;
  const CY = 52;
  const circ = Math.PI * R;
  const filled = (rate / 100) * circ;

  const pathArc = (startAngle: number, endAngle: number, rr: number) => {
    const s = [CX + rr * Math.cos(startAngle), CY + rr * Math.sin(startAngle)];
    const e = [CX + rr * Math.cos(endAngle), CY + rr * Math.sin(endAngle)];
    return `M ${s[0]} ${s[1]} A ${rr} ${rr} 0 1 1 ${e[0]} ${e[1]}`;
  };

  const color = rate >= 90 ? "#22c55e" : rate >= 60 ? "#f59e0b" : "#f43f5e";

  return (
    <svg viewBox="0 0 110 60" className="w-full max-w-[160px]" aria-label={`Collection rate ${rate}%`}>
      {/* Track */}
      <path d={pathArc(Math.PI, 0, R)} fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth={9} strokeLinecap="round" />
      {/* Fill */}
      <path
        d={pathArc(Math.PI, 0, R)}
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
        style={{ transition: "stroke-dasharray 1s ease" }}
      />
      <text x={CX} y={CY - 6} textAnchor="middle" fontSize={17} fontWeight="800" fill="currentColor">{rate}%</text>
      <text x={CX} y={CY + 7} textAnchor="middle" fontSize={7} fill="currentColor" fillOpacity={0.4}>collected</text>
      <text x={18} y={CY + 20} textAnchor="middle" fontSize={6.5} fill="currentColor" fillOpacity={0.3}>0%</text>
      <text x={92} y={CY + 20} textAnchor="middle" fontSize={6.5} fill="currentColor" fillOpacity={0.3}>100%</text>
    </svg>
  );
}

// ── SVG: Weekly sessions bars ──────────────────────────────────────────────────

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeeklyBars({ sessions, locale }: { sessions: CalendarSession[]; locale: string }) {
  const today = new Date();
  const todayStr = isoDate(today);

  const byDay = DAYS_SHORT.map((label, i) => {
    const d = new Date();
    const dow = d.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    const dt = new Date(d);
    dt.setDate(d.getDate() + offset + i);
    const dateStr = isoDate(dt);
    const daySessions = sessions.filter((s) => s.scheduled_at_utc.startsWith(dateStr));
    const completed = daySessions.filter((s) => s.status === "ATTENDED" || s.status === "ABSENT_EXCUSED" || s.status === "ABSENT_UNEXCUSED").length;
    const pending = daySessions.filter((s) => s.status === "SCHEDULED").length;
    const cancelled = daySessions.filter((s) => s.status === "CANCELLED_BY_TEACHER" || s.status === "CANCELLED_BY_STUDENT" || s.status === "RESCHEDULED").length;
    return { label, dateStr, total: daySessions.length, completed, pending, cancelled, isToday: dateStr === todayStr };
  });

  const maxTotal = Math.max(...byDay.map((d) => d.total), 1);
  const W = 280;
  const H = 100;
  const PT = 10;
  const PB = 22;
  const chartH = H - PT - PB;
  const colW = W / 7;
  const barW = colW * 0.48;

  if (byDay.every((d) => d.total === 0)) {
    return (
      <div className="flex h-24 flex-col items-center justify-center gap-1.5 text-center">
        <CalendarDays className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">No lessons this week</p>
      </div>
    );
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-label="Lessons this week">
        {byDay.map((d, i) => {
          const cx = colW * i + colW / 2;
          const totalH = (d.total / maxTotal) * chartH;
          const completedH = d.total > 0 ? (d.completed / d.total) * totalH : 0;
          const pendingH = d.total > 0 ? (d.pending / d.total) * totalH : 0;
          const cancelledH = totalH - completedH - pendingH;
          let yOffset = PT + chartH;

          return (
            <g key={d.label}>
              {d.isToday && (
                <rect x={cx - barW / 2 - 3} y={PT} width={barW + 6} height={chartH} rx={4} fill="currentColor" fillOpacity={0.04} />
              )}
              {d.completed > 0 && (() => { yOffset -= completedH; return <rect key="c" x={cx - barW / 2} y={yOffset} width={barW} height={completedH} rx={2} fill="#22c55e" opacity={0.85} />; })()}
              {d.pending > 0 && (() => { yOffset -= pendingH; return <rect key="p" x={cx - barW / 2} y={yOffset} width={barW} height={pendingH} rx={2} fill="#3b82f6" opacity={0.85} />; })()}
              {d.cancelled > 0 && (() => { yOffset -= cancelledH; return <rect key="x" x={cx - barW / 2} y={yOffset} width={barW} height={cancelledH} rx={2} fill="#94a3b8" opacity={0.6} />; })()}
              {d.total > 0 && (
                <text x={cx} y={PT + chartH - totalH - 3} textAnchor="middle" fontSize={8} fontWeight="600" fill="currentColor" fillOpacity={0.7}>{formatNumber(d.total, locale)}</text>
              )}
              <text x={cx} y={H - 7} textAnchor="middle" fontSize={8} fill="currentColor" fillOpacity={d.isToday ? 0.9 : 0.38} fontWeight={d.isToday ? "700" : "400"}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center gap-4 text-[11px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Done
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500" /> Scheduled
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-400" /> Cancelled
        </span>
      </div>
    </div>
  );
}

// ── SVG: Animated ring gauge for plan usage ────────────────────────────────────

function RingGauge({
  value,
  max,
  color,
  label,
  locale,
}: {
  value: number;
  max: number | null;
  color: string;
  label: string;
  locale: string;
}) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const pct = max ? Math.min(value / max, 1) : 0;
  const isCritical = max && pct >= 0.9;
  const fillColor = isCritical ? "#f43f5e" : color;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={R} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={7} />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke={fillColor}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${pct * C} ${C}`}
            style={{ transition: "stroke-dasharray 1s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-bold tabular-nums leading-none">{formatNumber(value, locale)}</span>
          {max && <span className="text-[9px] text-muted-foreground">/{formatNumber(max, locale)}</span>}
        </div>
      </div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {max && (
        <span className={cn("text-[10px] font-semibold", isCritical ? "text-rose-500" : "text-muted-foreground")}>
          {Math.round(pct * 100)}%
        </span>
      )}
    </div>
  );
}

// ── Trend delta badge ──────────────────────────────────────────────────────────

function TrendBadge({ delta }: { delta: number }) {
  const flat = Math.abs(delta) < 0.05;
  const up = delta >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        flat
          ? "bg-muted text-muted-foreground"
          : up
            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
            : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
      )}
    >
      {flat ? <Minus className="h-3 w-3" /> : up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

// ── Sleek SaaS stat card ─────────────────────────────────────────────────────────

interface StatCardProps {
  Icon: LucideIcon;
  color: string;
  label: string;
  value: number | null;
  sub?: string;
  loading: boolean;
  href?: string;
  alert?: boolean;
  trend?: number | null;
  spark?: boolean;
  sparkData?: number[];
  progress?: number;
  progressLabel?: string;
  isMoney?: boolean;
  moneyAmount?: number;
  moneyCurrency?: string;
  locale: string;
}

function StatCard({
  Icon, color, label, value, sub, loading, href, alert,
  trend, spark, sparkData, progress, progressLabel, isMoney,
  moneyAmount, moneyCurrency, locale,
}: StatCardProps) {
  const c = COLORS[color] ?? COLORS.slate!;
  const showSpark = !loading && spark && sparkData && sparkData.length > 1;
  const inner = (
    <div
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all duration-200",
        href && "hover:-translate-y-0.5 hover:shadow-lg",
        alert && "ring-1 ring-amber-300/70 dark:ring-amber-600/50",
      )}
    >
      {/* accent stripe + colored glow + vector watermark */}
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", c.stripe)} />
      <div className={cn("pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-3xl transition-transform duration-500 group-hover:scale-125", c.glow)} />
      <Icon
        className="pointer-events-none absolute -bottom-4 -right-3 h-24 w-24 text-foreground/[0.03] dark:text-foreground/[0.05]"
        strokeWidth={1.25}
        aria-hidden
      />

      <div className="relative flex items-start justify-between pt-0.5">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", c.chip)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex items-center gap-2">
          {!loading && trend != null && <TrendBadge delta={trend} />}
          {href && <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-foreground/70" />}
        </div>
      </div>

      <div className="relative mt-3.5">
        {loading ? (
          <>
            <Sk className="mb-2 h-8 w-24" />
            <Sk className="h-3.5 w-28" />
          </>
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight tabular-nums">
              {isMoney && moneyAmount !== undefined && moneyCurrency
                ? formatMoney({ amount: moneyAmount, currency: moneyCurrency }, locale)
                : value !== null
                  ? <CountUp value={value} locale={locale} />
                  : "—"}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-foreground/80">{label}</p>
            {sub && <p className={cn("mt-0.5 text-xs font-medium", c.text)}>{sub}</p>}
          </>
        )}
      </div>

      {!loading && progress !== undefined && (
        <div className="relative mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", progress >= 90 ? "from-rose-500 to-red-500" : c.stripe)}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          {progressLabel && <p className="mt-1.5 text-[11px] text-muted-foreground">{progressLabel}</p>}
        </div>
      )}

      {showSpark && (
        <div className="relative -mx-4 -mb-4 mt-3 h-10 opacity-90">
          <Sparkline data={sparkData!} color={c.spark} className="h-full w-full" />
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

// ── Pending session row ────────────────────────────────────────────────────────

function PendingRow({ session, locale }: { session: PendingSession; locale: string }) {
  const at = new Date(session.scheduled_at_utc);
  const diffMs = Date.now() - at.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffM = Math.floor((diffMs % 3_600_000) / 60_000);
  const ago = diffH >= 24 ? `${Math.floor(diffH / 24)}d ago` : diffH > 0 ? `${diffH}h ${diffM}m ago` : `${diffM}m ago`;

  return (
    <Link
      href="/attendance"
      className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-all hover:border-amber-300 hover:bg-amber-50/50 dark:hover:bg-amber-950/20"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
        <Clock className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{session.student_name ?? "—"}</p>
        <p className="truncate text-xs text-muted-foreground">{session.teacher_name ?? "—"}</p>
      </div>
      <div className="shrink-0 text-right">
        <span className="block rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at)}
        </span>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{ago}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-amber-400 opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

// ── Quick action card ──────────────────────────────────────────────────────────

function ActionCard({
  href,
  Icon,
  color,
  label,
  desc,
  badge,
}: {
  href: string;
  Icon: LucideIcon;
  color: string;
  label: string;
  desc: string;
  badge?: number;
}) {
  const c = COLORS[color] ?? COLORS.slate!;
  return (
    <Link
      href={href}
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-card p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className={cn("pointer-events-none absolute -left-6 -top-6 h-16 w-16 rounded-full blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100", c.glow)} />
      <span className={cn("relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-110", c.chip)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{desc}</p>
      </div>
      {badge !== undefined && badge > 0 ? (
        <span className="relative flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white shadow-sm">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : (
        <ArrowRight className="relative h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-foreground/70" />
      )}
    </Link>
  );
}

// ── Section header (inside cards) ────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h3>
      {action}
    </div>
  );
}

// ── Section title (page-level group heading) ─────────────────────────────────────

function SectionTitle({
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
  action?: React.ReactNode;
}) {
  const c = COLORS[color] ?? COLORS.violet!;
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm", c.chip)}>
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div>
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function ViewAllLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
      {label} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

// ── Color system — vivid gradient chips, accent stripes, glows & sparkline hues ───

interface ColorDef {
  chip: string;   // gradient bg for the icon chip (white icon on top)
  stripe: string; // gradient for the top accent stripe
  glow: string;   // blurred decorative blob tint
  text: string;   // accent text colour
  spark: string;  // sparkline stroke/fill hex
}

const COLORS: Record<string, ColorDef> = {
  emerald: { chip: "from-emerald-500 to-teal-500", stripe: "from-emerald-500 to-teal-500", glow: "bg-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", spark: "#10b981" },
  green: { chip: "from-green-500 to-emerald-500", stripe: "from-green-500 to-emerald-500", glow: "bg-green-500/20", text: "text-green-600 dark:text-green-400", spark: "#22c55e" },
  teal: { chip: "from-teal-500 to-cyan-500", stripe: "from-teal-500 to-cyan-500", glow: "bg-teal-500/20", text: "text-teal-600 dark:text-teal-400", spark: "#14b8a6" },
  cyan: { chip: "from-cyan-500 to-sky-500", stripe: "from-cyan-500 to-sky-500", glow: "bg-cyan-500/20", text: "text-cyan-600 dark:text-cyan-400", spark: "#06b6d4" },
  sky: { chip: "from-sky-500 to-blue-500", stripe: "from-sky-500 to-blue-500", glow: "bg-sky-500/20", text: "text-sky-600 dark:text-sky-400", spark: "#0ea5e9" },
  blue: { chip: "from-blue-500 to-indigo-500", stripe: "from-blue-500 to-indigo-500", glow: "bg-blue-500/20", text: "text-blue-600 dark:text-blue-400", spark: "#3b82f6" },
  indigo: { chip: "from-indigo-500 to-violet-500", stripe: "from-indigo-500 to-violet-500", glow: "bg-indigo-500/20", text: "text-indigo-600 dark:text-indigo-400", spark: "#6366f1" },
  violet: { chip: "from-violet-500 to-purple-500", stripe: "from-violet-500 to-purple-500", glow: "bg-violet-500/20", text: "text-violet-600 dark:text-violet-400", spark: "#8b5cf6" },
  fuchsia: { chip: "from-fuchsia-500 to-pink-500", stripe: "from-fuchsia-500 to-pink-500", glow: "bg-fuchsia-500/20", text: "text-fuchsia-600 dark:text-fuchsia-400", spark: "#d946ef" },
  amber: { chip: "from-amber-500 to-orange-500", stripe: "from-amber-500 to-orange-500", glow: "bg-amber-500/20", text: "text-amber-600 dark:text-amber-400", spark: "#f59e0b" },
  orange: { chip: "from-orange-500 to-red-500", stripe: "from-orange-500 to-red-500", glow: "bg-orange-500/20", text: "text-orange-600 dark:text-orange-400", spark: "#f97316" },
  rose: { chip: "from-rose-500 to-pink-500", stripe: "from-rose-500 to-pink-500", glow: "bg-rose-500/20", text: "text-rose-600 dark:text-rose-400", spark: "#f43f5e" },
  slate: { chip: "from-slate-500 to-slate-600", stripe: "from-slate-400 to-slate-500", glow: "bg-slate-500/20", text: "text-slate-600 dark:text-slate-300", spark: "#64748b" },
};

// ── Main dashboard ─────────────────────────────────────────────────────────────

export function AcademyDashboard() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const router = useRouter();
  const { session, can } = useAuth();

  // A Super Admin who has NOT entered an academy has no tenant data to show — their home is
  // the platform overview (admin panel — Phase 1). Redirect rather than render an empty shell.
  const onPlatform =
    session?.role === "SUPER_ADMIN" && session.academyId === null;
  useEffect(() => {
    if (onPlatform) router.replace("/admin");
  }, [onPlatform, router]);

  const [studentsTotal, setStudentsTotal] = useState<number | null>(null);
  const [teachersTotal, setTeachersTotal] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingSession[] | null>(null);
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary | null>(null);
  const [profitMonths, setProfitMonths] = useState<MonthPoint[]>([]);
  // Current-month profit broken out per currency — drives the teacher-salary and net-profit
  // admin KPI cards (payouts = total teacher salaries; profit = revenue after discounts − salaries).
  const [monthProfit, setMonthProfit] = useState<ProfitSummaryRow[] | null>(null);
  const [weekSessions, setWeekSessions] = useState<CalendarSession[] | null>(null);
  const [monthSessions, setMonthSessions] = useState<CalendarSession[] | null>(null);
  const [trialStudentIds, setTrialStudentIds] = useState<Set<string>>(new Set());
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  // The signed-in teacher's earnings for the current month (their open payout total).
  const [myEarnings, setMyEarnings] = useState<{ amount: number; currency: string | null } | null>(null);

  const [ldPeople, setLdPeople] = useState(true);
  const [ldAttend, setLdAttend] = useState(true);
  const [ldInv, setLdInv] = useState(true);
  const [ldProfit, setLdProfit] = useState(true);
  const [ldWeek, setLdWeek] = useState(true);
  const [ldMonth, setLdMonth] = useState(true);
  const [ldEarnings, setLdEarnings] = useState(true);
  const [ldPlan, setLdPlan] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((isRefresh = false) => {
    // On initial load, show skeletons. On refresh, keep existing data visible.
    if (!isRefresh) {
      setLdPeople(true);
      setLdAttend(true);
      setLdInv(true);
      setLdMonth(true);
      setLdEarnings(true);
      setLdProfit(true);
      setLdWeek(true);
      setLdPlan(true);
    }

    // Fire all fetches simultaneously — nothing blocks anything else.
    Promise.all([
      can("student.read") ? listStudents({ pageSize: 1 }).then((r) => setStudentsTotal(r.total)).catch(() => {}) : Promise.resolve(),
      can("teacher.read") ? listTeachers({ pageSize: 1 }).then((r) => setTeachersTotal(r.total)).catch(() => {}) : Promise.resolve(),
    ]).finally(() => setLdPeople(false));

    if (can("attendance.record") || can("attendance.read")) {
      getPendingAttendance().then((r) => setPending(r.sessions)).catch(() => setPending([])).finally(() => setLdAttend(false));
    } else {
      setLdAttend(false);
      setPending([]);
    }

    if (can("invoice.view")) {
      getInvoiceSummary()
        .then(setInvoiceSummary)
        .catch(() => {})
        .finally(() => setLdInv(false));
    } else {
      setLdInv(false);
    }

    if (can("schedule.read") || can("attendance.read")) {
      const now = new Date();
      const fromM = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const toM = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      getCalendar({ from: fromM, to: toM })
        .then((r) => setMonthSessions(r.sessions))
        .catch(() => setMonthSessions([]))
        .finally(() => setLdMonth(false));

      const { from, to } = getCurrentWeek();
      getCalendar({ from, to }).then((r) => setWeekSessions(r.sessions)).catch(() => setWeekSessions([])).finally(() => setLdWeek(false));
    } else {
      setLdMonth(false);
      setLdWeek(false);
    }

    if (can("student.read")) {
      // Both trial statuses: a learner becomes TRIAL_BOOKED the moment their trial
      // is scheduled, so TRIAL alone would miss every actually-booked trial.
      listStudents({ filter: { trial_any: "1" }, pageSize: 200 })
        .then((r) => setTrialStudentIds(new Set(r.rows.map((s) => s.id))))
        .catch(() => {});
    }

    // A teacher's earnings so far this month: their OPEN payout for the current period
    // (the authoritative figure — already excludes free trials, prorated by attendance).
    if (can("payout.read_own")) {
      const now = new Date();
      const yr = now.getFullYear();
      const mo = now.getMonth() + 1;
      listMyPayouts({ pageSize: 50, sort: "-period" })
        .then((r) => {
          const current = r.rows.find((p) => p.period_year === yr && p.period_month === mo);
          // Fall back to the latest period's currency so the card can render money even
          // before any lesson has been attended this month.
          const currency = current?.currency ?? r.rows[0]?.currency ?? null;
          setMyEarnings({ amount: current?.total_minor ?? 0, currency });
        })
        .catch(() => setMyEarnings({ amount: 0, currency: null }))
        .finally(() => setLdEarnings(false));
    } else {
      setLdEarnings(false);
    }

    if (can("payout.read") || can("invoice.view")) {
      const months = getLast6Months();
      Promise.all(months.map((m) =>
        can("payout.read")
          ? getProfitSummary(m.year, m.month).catch(() => null)
          : Promise.resolve(null)
      )).then((results) => {
        const pts: MonthPoint[] = months.map((m, i) => {
          const r = results[i] as ProfitSummary | null;
          const row = r?.rows?.[0];
          return { year: m.year, month: m.month, revenue: row?.revenue_minor ?? 0, payouts: row?.payouts_minor ?? 0 };
        });
        setProfitMonths(pts);
        // The last entry is the current month — keep its full per-currency breakdown for the
        // teacher-salary and net-profit cards.
        const current = results[results.length - 1] as ProfitSummary | null;
        setMonthProfit(current?.rows ?? []);
      }).finally(() => setLdProfit(false));
    } else {
      setLdProfit(false);
    }

    getEntitlements().then(setEntitlements).catch(() => {}).finally(() => setLdPlan(false));
  }, [can]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load(true);
    setTimeout(() => setRefreshing(false), 1500);
  }, [load]);

  // Derived values
  const pendingCount = pending?.length ?? 0;
  const openInvoices = invoiceSummary?.counts.OPEN ?? 0;
  const bucket = invoiceSummary?.money[0];
  const collectionRate = bucket?.billed_minor
    ? Math.round((bucket.collected_minor / bucket.billed_minor) * 100)
    : 0;
  const revSparkData = useMemo(() => profitMonths.map((p) => p.revenue), [profitMonths]);

  // Month-over-month revenue change — drives the trend badge on the revenue analytics card.
  // Null when there is no prior month with revenue to compare against (avoids divide-by-zero
  // and misleading "+100%" deltas from an empty baseline).
  const revenueTrend = useMemo<number | null>(() => {
    const cur = profitMonths[profitMonths.length - 1];
    const prev = profitMonths[profitMonths.length - 2];
    if (!cur || !prev || prev.revenue <= 0) return null;
    return ((cur.revenue - prev.revenue) / prev.revenue) * 100;
  }, [profitMonths]);

  // Total hours this month. A teacher sees only the hours they have actually taught so
  // far (ATTENDED), not future scheduled lessons. Owners keep the planned-hours view
  // (every non-cancelled, non-rescheduled lesson in the month).
  const teacherView = session?.role === "TEACHER";
  const totalMinutesMonth = useMemo(() => {
    if (!monthSessions) return 0;
    const counted = teacherView
      ? monthSessions.filter((s) => s.status === "ATTENDED")
      : monthSessions.filter((s) => s.status !== "CANCELLED_BY_TEACHER" && s.status !== "CANCELLED_BY_STUDENT" && s.status !== "RESCHEDULED");
    return counted.reduce((sum, s) => sum + s.duration_minutes, 0);
  }, [monthSessions, teacherView]);
  const hoursMonth = Math.floor(totalMinutesMonth / 60);
  const minsMonth = totalMinutesMonth % 60;

  // This week's trial lessons. A trial is an ad-hoc one-off session (schedule_id null);
  // a trial learner's recurring lessons (schedule_id set) are regular lessons, not trials,
  // so we exclude them — the section must show trials only, not every booking.
  const trialLessonsThisWeek = useMemo(
    () => (weekSessions ?? []).filter((s) => trialStudentIds.has(s.student_id) && s.schedule_id === null),
    [weekSessions, trialStudentIds],
  );

  // Total amount owed per currency across every academy that has bills (all-time, non-VOID).
  const dueByCurrency = useMemo(
    () => (invoiceSummary?.money ?? []).filter((m) => m.due_minor > 0),
    [invoiceSummary],
  );
  // Teacher salaries (payouts) and net profit for the current month, per currency.
  const salariesByCurrency = useMemo(
    () => (monthProfit ?? []).filter((r) => r.payouts_minor > 0),
    [monthProfit],
  );
  const profitByCurrency = useMemo(
    () => (monthProfit ?? []).filter((r) => r.revenue_minor > 0 || r.payouts_minor > 0),
    [monthProfit],
  );
  // Money cards always render (per product choice) even before any invoice exists. When there is
  // no invoice bucket to read a currency from, fall back to the academy's payout/earnings currency
  // so the placeholder "0" still formats sensibly instead of guessing a hard-coded currency.
  const fallbackCurrency =
    bucket?.currency ??
    monthProfit?.find((r) => r.currency)?.currency ??
    myEarnings?.currency ??
    "EGP";
  const canInvoice = can("invoice.view");
  const invoiceCount = invoiceSummary?.counts.all ?? 0;
  const studentLimit = entitlements?.limits?.students ?? null;
  const teacherLimit = entitlements?.limits?.teachers ?? null;
  const studentUsage = entitlements?.usage?.students ?? studentsTotal ?? 0;
  const teacherUsage = entitlements?.usage?.teachers ?? teachersTotal ?? 0;
  const planName = entitlements?.plan ?? null;
  const isTeacher = session?.role === "TEACHER";
  const isSuperAdmin = session?.role === "SUPER_ADMIN";

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t("greeting.morning");
    if (h < 17) return t("greeting.afternoon");
    return t("greeting.evening");
  })();

  const dateLabel = new Date().toLocaleDateString(
    locale === "ar" ? "ar-u-nu-arab" : locale,
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  );

  // Redirecting to the platform overview — render nothing to avoid a flash of empty cards.
  if (onPlatform) return null;

  return (
    <div className="space-y-5 pb-4">
      {/* ── Hero header ── */}
      <header className="relative overflow-hidden rounded-2xl border border-transparent bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-6 text-white shadow-lg sm:p-7">
        {/* Vector flourishes: dot grid + glowing orbs */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]" aria-hidden>
          <defs>
            <pattern id="hero-dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-dots)" />
        </svg>
        <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/4 h-48 w-48 rounded-full bg-fuchsia-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-6 bottom-0 opacity-10">
          <GraduationCap className="h-40 w-40" strokeWidth={1} />
        </div>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-white/80">
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>{dateLabel}</span>
            </div>
            <h1 className="mt-1.5 truncate text-2xl font-bold tracking-tight drop-shadow-sm sm:text-[1.7rem]">
              {greeting}, {session?.user.fullName?.split(" ")[0] ?? "—"} 👋
            </h1>
            <p className="mt-1 text-sm text-white/85">{t("hero.subtitle")}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
              </span>
              {t("hero.live")}
            </span>
            {planName && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white px-2.5 py-1 text-xs font-bold text-violet-700 shadow-sm">
                <Sparkles className="h-3 w-3" />
                {planName}
              </span>
            )}
            <button
              onClick={() => void refresh()}
              disabled={refreshing}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/25 bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25 disabled:opacity-60"
              title="Refresh"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      <SubscriptionBanner />

      {/* ── Key metrics ── */}
      <section className="space-y-3">
        <SectionTitle
          Icon={Activity}
          color="violet"
          title={t("sections.metrics")}
          desc={t("sections.metricsDesc")}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {can("student.read") && (
            <StatCard
              Icon={GraduationCap}
              color="emerald"
              label={t("kpi.students")}
              value={studentsTotal}
              sub={t("kpi.activeStudents")}
              loading={ldPeople}
              href="/students"
              locale={locale}
              progress={studentLimit && studentsTotal !== null ? Math.round((studentsTotal / studentLimit) * 100) : undefined}
              progressLabel={studentLimit ? `${studentLimit - (studentsTotal ?? 0)} ${t("kpi.slotsRemaining")}` : undefined}
            />
          )}
          {can("teacher.read") && (
            <StatCard
              Icon={Users}
              color="violet"
              label={t("kpi.teachers")}
              value={teachersTotal}
              sub={t("kpi.totalTeachers")}
              loading={ldPeople}
              href="/teachers"
              locale={locale}
              progress={teacherLimit && teachersTotal !== null ? Math.round((teachersTotal / teacherLimit) * 100) : undefined}
              progressLabel={teacherLimit ? `${teacherLimit - (teachersTotal ?? 0)} ${t("kpi.slotsRemaining")}` : undefined}
            />
          )}
          {(can("schedule.read") || can("attendance.read")) && (
            <StatCard
              Icon={CalendarDays}
              color="cyan"
              label={t("kpi.sessionsThisWeek")}
              value={ldWeek ? null : weekSessions?.length ?? 0}
              sub={t("kpi.sessionsThisWeekSub")}
              loading={ldWeek}
              href="/calendar"
              locale={locale}
            />
          )}
          {(can("attendance.record") || can("attendance.read")) && (
            <StatCard
              Icon={ClipboardCheck}
              color={pendingCount > 0 ? "amber" : "slate"}
              label={t("kpi.pendingAttendance")}
              value={ldAttend ? null : pendingCount}
              sub={t("kpi.sessionsNeedAttendance")}
              loading={ldAttend}
              href="/attendance"
              alert={pendingCount > 0}
              locale={locale}
            />
          )}
          {can("invoice.view") && (
            <StatCard
              Icon={ReceiptText}
              color={openInvoices > 0 ? "blue" : "slate"}
              label={t("kpi.openInvoices")}
              value={ldInv ? null : openInvoices}
              sub={t("kpi.awaitingPayment")}
              loading={ldInv}
              href="/invoices"
              alert={openInvoices > 0}
              locale={locale}
            />
          )}
          {(can("schedule.read") || can("attendance.read")) && (
            <StatCard
              Icon={Timer}
              color="orange"
              label={t("kpi.hoursThisMonth")}
              value={ldMonth ? null : hoursMonth}
              sub={ldMonth ? "" : `${minsMonth}m · ${t(isTeacher ? "kpi.hoursThisMonthSubTaught" : "kpi.hoursThisMonthSub")}`}
              loading={ldMonth}
              href="/calendar"
              locale={locale}
            />
          )}
          {can("payout.read_own") && (
            <StatCard
              Icon={Wallet}
              color="green"
              label={t("kpi.earningsThisMonth")}
              value={!ldEarnings && myEarnings?.currency == null ? myEarnings?.amount ?? 0 : null}
              isMoney={!ldEarnings && myEarnings?.currency != null}
              moneyAmount={myEarnings?.amount ?? 0}
              moneyCurrency={myEarnings?.currency ?? undefined}
              sub={t("kpi.earningsThisMonthSub")}
              loading={ldEarnings}
              href="/payroll"
              locale={locale}
            />
          )}
        </div>
      </section>

      {/* ── Financial overview ── */}
      {(can("invoice.view") || can("payout.read")) && (
        <section className="space-y-3">
          <SectionTitle
            Icon={Wallet}
            color="emerald"
            title={t("finance.title")}
            desc={t("finance.subtitle")}
            action={<ViewAllLink href="/financial-statistics" label={t("finance.viewAll")} />}
          />

          {/* Money headline cards — always visible within the financial section */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                Icon={Wallet}
                color="teal"
                label={t("finance.collected")}
                value={null}
                isMoney
                moneyAmount={bucket?.collected_minor ?? 0}
                moneyCurrency={bucket?.currency ?? fallbackCurrency}
                sub={`${collectionRate}% ${t("kpi.collectionRate")}`}
                loading={ldInv}
                href={canInvoice ? "/invoices" : undefined}
                trend={revenueTrend}
                sparkData={revSparkData.length > 1 ? revSparkData : undefined}
                spark
                locale={locale}
              />
              <StatCard
                Icon={BarChart3}
                color="indigo"
                label={t("finance.billed")}
                value={null}
                isMoney
                moneyAmount={bucket?.billed_minor ?? 0}
                moneyCurrency={bucket?.currency ?? fallbackCurrency}
                sub={t("kpi.totalBilledSub")}
                loading={ldInv}
                href={canInvoice ? "/financial-statistics" : undefined}
                locale={locale}
              />
              <StatCard
                Icon={Clock}
                color="rose"
                label={t("finance.outstanding")}
                value={null}
                isMoney
                moneyAmount={bucket?.outstanding_minor ?? 0}
                moneyCurrency={bucket?.currency ?? fallbackCurrency}
                sub={t("kpi.outstandingSub")}
                loading={ldInv}
                href={canInvoice ? "/invoices" : undefined}
                alert={(bucket?.outstanding_minor ?? 0) > 0}
                locale={locale}
              />
              <StatCard
                Icon={CheckCircle2}
                color="green"
                label={t("kpi.paidInvoices")}
                value={ldInv ? null : invoiceSummary?.counts.PAID ?? 0}
                sub={t("kpi.paidInvoicesSub")}
                loading={ldInv}
                href={canInvoice ? "/invoices" : undefined}
                progress={invoiceCount > 0 ? Math.round(((invoiceSummary?.counts.PAID ?? 0) / invoiceCount) * 100) : undefined}
                progressLabel={invoiceCount > 0 ? `${invoiceSummary?.counts.PAID ?? 0}/${invoiceCount}` : undefined}
                locale={locale}
              />
              <StatCard
                Icon={Activity}
                color="sky"
                label={t("kpi.avgInvoice")}
                value={null}
                isMoney
                moneyAmount={invoiceCount > 0 ? Math.round((bucket?.billed_minor ?? 0) / invoiceCount) : 0}
                moneyCurrency={bucket?.currency ?? fallbackCurrency}
                sub={t("kpi.avgInvoiceSub")}
                loading={ldInv}
                href={canInvoice ? "/financial-statistics" : undefined}
                locale={locale}
              />
              {can("invoice.view") && !ldInv && dueByCurrency.map((m) => (
                <StatCard
                  key={`due-${m.currency}`}
                  Icon={ReceiptText}
                  color="fuchsia"
                  label={`${t("kpi.totalDue")} · ${m.currency}`}
                  value={null}
                  isMoney
                  moneyAmount={m.due_minor}
                  moneyCurrency={m.currency}
                  sub={t("kpi.totalDueSub")}
                  loading={false}
                  href="/invoices"
                  alert
                  locale={locale}
                />
              ))}
              {can("payout.read") && !ldProfit && salariesByCurrency.map((r) => (
                <StatCard
                  key={`salary-${r.currency}`}
                  Icon={Wallet}
                  color="rose"
                  label={`${t("kpi.teacherSalaries")} · ${r.currency}`}
                  value={null}
                  isMoney
                  moneyAmount={r.payouts_minor}
                  moneyCurrency={r.currency}
                  sub={t("kpi.teacherSalariesSub")}
                  loading={false}
                  href="/payroll"
                  locale={locale}
                />
              ))}
              {can("payout.read") && !ldProfit && profitByCurrency.map((r) => (
                <StatCard
                  key={`profit-${r.currency}`}
                  Icon={BarChart3}
                  color={r.profit_minor >= 0 ? "emerald" : "rose"}
                  label={`${t("kpi.netProfit")} · ${r.currency}`}
                  value={null}
                  isMoney
                  moneyAmount={r.profit_minor}
                  moneyCurrency={r.currency}
                  sub={t("kpi.netProfitSub")}
                  loading={false}
                  href="/financial-statistics"
                  locale={locale}
                />
              ))}
          </div>

          {/* Analytics: revenue chart + invoice mix */}
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="rounded-xl border bg-card p-5 lg:col-span-3">
              <SectionHeader
                icon={<BarChart3 className="h-4 w-4" />}
                title={t("finance.revenueChart")}
                action={
                  <div className="flex items-center gap-2">
                    {revenueTrend != null && <TrendBadge delta={revenueTrend} />}
                    <ViewAllLink href="/financial-statistics" label={t("finance.viewAll")} />
                  </div>
                }
              />
              <div className="mt-4">
                {ldProfit ? (
                  <div className="flex h-44 items-center justify-center">
                    <Spin className="h-6 w-6 text-muted-foreground" />
                  </div>
                ) : profitMonths.length > 0 ? (
                  <RevenueBarChart data={profitMonths} locale={locale} />
                ) : (
                  <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
                    {t("empty.noData")}
                  </div>
                )}
              </div>

              {bucket && !ldInv && (
                <div className="mt-4 grid grid-cols-3 divide-x rounded-xl bg-muted/40 text-center">
                  {[
                    { label: t("finance.billed"), val: bucket.billed_minor, color: "text-foreground" },
                    { label: t("finance.collected"), val: bucket.collected_minor, color: "text-emerald-600 dark:text-emerald-400" },
                    { label: t("finance.outstanding"), val: bucket.outstanding_minor, color: bucket.outstanding_minor > 0 ? "text-rose-500" : "text-muted-foreground" },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="px-4 py-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                      <p className={cn("mt-0.5 text-sm font-bold tabular-nums", color)}>
                        {formatMoney({ amount: val, currency: bucket.currency }, locale)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 lg:col-span-2">
              <div className="rounded-xl border bg-card p-5">
                <SectionHeader icon={<ReceiptText className="h-4 w-4" />} title={t("finance.invoiceBreakdown")} />
                <div className="mt-4">
                  {ldInv ? (
                    <div className="flex h-24 items-center justify-center">
                      <Spin className="h-5 w-5 text-muted-foreground" />
                    </div>
                  ) : invoiceSummary ? (
                    <InvoiceDonut counts={invoiceSummary.counts} locale={locale} />
                  ) : null}
                </div>
              </div>

              {bucket && !ldInv && (
                <div className="rounded-xl border bg-card p-5">
                  <SectionHeader icon={<Wallet className="h-4 w-4" />} title={t("finance.collectionRate")} />
                  <div className="mt-3 flex justify-center">
                    <CollectionGauge rate={collectionRate} />
                  </div>
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    {formatMoney({ amount: bucket.collected_minor, currency: bucket.currency }, locale)} {t("finance.ofBilled")}{" "}
                    {formatMoney({ amount: bucket.billed_minor, currency: bucket.currency }, locale)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Operations ── */}
      {(can("schedule.read") || can("attendance.read") || can("attendance.record")) && (
        <section className="space-y-3">
          <SectionTitle
            Icon={CalendarDays}
            color="blue"
            title={t("sections.operations")}
            desc={t("sections.operationsDesc")}
          />
          <div className="grid gap-4 lg:grid-cols-5">
            {(can("schedule.read") || can("attendance.read")) && (
              <div className="rounded-xl border bg-card p-5 lg:col-span-2">
                <SectionHeader
                  icon={<CalendarDays className="h-4 w-4" />}
                  title={t("week.title")}
                  action={<ViewAllLink href="/calendar" label={t("week.viewCalendar")} />}
                />
                <div className="mt-4">
                  {ldWeek ? (
                    <div className="flex h-24 items-center justify-center">
                      <Spin className="h-5 w-5 text-muted-foreground" />
                    </div>
                  ) : (
                    <WeeklyBars sessions={weekSessions ?? []} locale={locale} />
                  )}
                </div>
                {!ldWeek && weekSessions && weekSessions.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: t("week.total"), val: weekSessions.length, color: "text-foreground" },
                      { label: t("week.done"), val: weekSessions.filter((s) => s.status === "ATTENDED" || s.status === "ABSENT_EXCUSED" || s.status === "ABSENT_UNEXCUSED").length, color: "text-emerald-600" },
                      { label: t("week.scheduled"), val: weekSessions.filter((s) => s.status === "SCHEDULED").length, color: "text-blue-500" },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="rounded-lg bg-muted/50 py-2">
                        <p className={cn("text-lg font-bold tabular-nums", color)}>{formatNumber(val, locale)}</p>
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(can("attendance.record") || can("attendance.read")) && (
              <div className={cn("rounded-xl border bg-card p-5", can("schedule.read") || can("attendance.read") ? "lg:col-span-3" : "lg:col-span-5")}>
                <SectionHeader
                  icon={<Clock className="h-4 w-4" />}
                  title={t("pending.title")}
                  action={
                    <div className="flex items-center gap-2">
                      {!ldAttend && pendingCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                          {pendingCount}
                        </span>
                      )}
                      <ViewAllLink href="/attendance" label={t("pending.viewAll")} />
                    </div>
                  }
                />
                <div className="mt-4 space-y-2">
                  {ldAttend ? (
                    [1, 2, 3].map((k) => (
                      <div key={k} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                        <Sk className="h-9 w-9 rounded-xl" />
                        <div className="flex-1 space-y-2">
                          <Sk className="h-3.5 w-36" />
                          <Sk className="h-3 w-24" />
                        </div>
                        <Sk className="h-6 w-14 rounded-lg" />
                      </div>
                    ))
                  ) : pending && pending.length > 0 ? (
                    pending.slice(0, 5).map((s) => <PendingRow key={s.id} session={s} locale={locale} />)
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-muted/20 py-12 text-center">
                      <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                      <p className="font-semibold">{t("pending.allClear")}</p>
                      <p className="text-sm text-muted-foreground">{t("pending.noSessions")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── This week's trials ── */}
      {can("student.read") && (can("schedule.read") || can("attendance.read")) && (
        <div className="rounded-xl border bg-card p-5">
          <SectionHeader
            icon={<FlaskConical className="h-4 w-4" />}
            title={t("trials.title")}
            action={<ViewAllLink href="/students?tab=trials" label={t("trials.viewAll")} />}
          />
          <div className="mt-4">
            {ldWeek ? (
              <div className="flex h-16 items-center justify-center">
                <Spin className="h-5 w-5 text-muted-foreground" />
              </div>
            ) : trialLessonsThisWeek.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 py-10 text-center">
                <FlaskConical className="h-8 w-8 text-violet-300" />
                <p className="text-sm text-muted-foreground">{t("trials.noTrials")}</p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {trialLessonsThisWeek.map((s) => {
                  const dt = new Date(s.scheduled_at_utc);
                  const dayLabel = dt.toLocaleDateString(locale.startsWith("ar") ? "ar-u-nu-arab" : locale, { weekday: "short" });
                  const timeLabel = dt.toLocaleTimeString(locale.startsWith("ar") ? "ar-u-nu-arab" : locale, { hour: "2-digit", minute: "2-digit" });
                  const statusColor =
                    s.status === "ATTENDED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : s.status === "ABSENT_UNEXCUSED" ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                    : s.status === "CANCELLED_BY_TEACHER" || s.status === "CANCELLED_BY_STUDENT" ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950/40">
                        <FlaskConical className="h-4 w-4 text-violet-600 dark:text-violet-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-tight">{s.student_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{s.teacher_name ?? "—"} · {dayLabel} {timeLabel}</p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", statusColor)}>
                        {s.status === "ATTENDED" ? "✓" : s.status === "SCHEDULED" ? "—" : "✗"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {!ldWeek && trialLessonsThisWeek.length > 0 && (
              <div className="mt-3 flex items-center gap-4 rounded-xl bg-violet-50 px-4 py-2.5 dark:bg-violet-950/20">
                <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                  {formatNumber(trialLessonsThisWeek.length, locale)}
                </span>
                <span className="text-xs text-muted-foreground">{t("trials.title")}</span>
                <span className="ms-auto text-xs font-medium text-violet-600 dark:text-violet-400">
                  {formatNumber(trialLessonsThisWeek.filter((s) => s.status === "ATTENDED").length, locale)} ✓
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Plan usage ── */}
      {!isTeacher && !isSuperAdmin && !ldPlan && entitlements && (studentLimit !== null || teacherLimit !== null) && (
        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <SectionHeader icon={<Sparkles className="h-4 w-4" />} title={t("plan.usage")} />
            <ViewAllLink href="/plan" label={t("plan.managePlan")} />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-12">
            {studentLimit !== null && (
              <RingGauge value={studentUsage} max={studentLimit} color="#10b981" label={t("plan.students")} locale={locale} />
            )}
            {teacherLimit !== null && (
              <RingGauge value={teacherUsage} max={teacherLimit} color="#8b5cf6" label={t("plan.teachers")} locale={locale} />
            )}
          </div>
        </div>
      )}

      {/* ── Quick actions ── */}
      <section className="space-y-3">
        <SectionTitle Icon={Sparkles} color="fuchsia" title={t("actions.title")} desc={t("actions.subtitle")} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {can("student.create") && (
            <ActionCard href="/students" Icon={GraduationCap} color="emerald" label={t("actions.addStudent")} desc={t("actions.addStudentDesc")} />
          )}
          {(can("attendance.record") || can("attendance.read")) && (
            <ActionCard href="/attendance" Icon={ClipboardCheck} color="amber" label={t("actions.markAttendance")} desc={t("actions.markAttendanceDesc")} badge={pendingCount} />
          )}
          {can("invoice.view") && (
            <ActionCard href="/invoices" Icon={ReceiptText} color="blue" label={t("actions.viewInvoices")} desc={t("actions.viewInvoicesDesc")} badge={openInvoices} />
          )}
          {can("schedule.read") && (
            <ActionCard href="/calendar" Icon={CalendarDays} color="violet" label={t("actions.viewCalendar")} desc={t("actions.viewCalendarDesc")} />
          )}
          {can("payout.read") && (
            <ActionCard href="/payroll" Icon={Wallet} color="rose" label={t("actions.payroll")} desc={t("actions.payrollDesc")} />
          )}
          {can("payout.read_own") && !can("payout.read") && (
            <ActionCard href="/payroll" Icon={Wallet} color="rose" label={t("actions.myPayroll")} desc={t("actions.myPayrollDesc")} />
          )}
          {can("invoice.view") && (
            <ActionCard href="/financial-statistics" Icon={BarChart3} color="indigo" label={t("actions.financialStats")} desc={t("actions.financialStatsDesc")} />
          )}
          {can("student.read") && (
            <ActionCard href="/sessions" Icon={BookOpen} color="cyan" label={t("actions.sessions")} desc={t("actions.sessionsDesc")} />
          )}
        </div>
      </section>
    </div>
  );
}
