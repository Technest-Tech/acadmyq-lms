"use client";

import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FlaskConical,
  GraduationCap,
  LayoutDashboard,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Timer,
  Users,
  Wallet,
} from "lucide-react";
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
      <div className="mt-2 flex items-center gap-4">
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          Revenue
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
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
                <text x={cx} y={PT + chartH - totalH - 3} textAnchor="middle" fontSize={8} fontWeight="600" fill="currentColor" fillOpacity={0.7}>{d.total}</text>
              )}
              <text x={cx} y={H - 7} textAnchor="middle" fontSize={8} fill="currentColor" fillOpacity={d.isToday ? 0.9 : 0.38} fontWeight={d.isToday ? "700" : "400"}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center gap-3">
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Done
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
          <span className="h-2 w-2 rounded-sm bg-blue-500" /> Scheduled
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          <span className="h-2 w-2 rounded-sm bg-slate-400" /> Cancelled
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

// ── KPI gradient card ──────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  sub?: string;
  loading: boolean;
  gradient: string;
  iconBg: string;
  href?: string;
  pulse?: boolean;
  sparkData?: number[];
  sparkColor?: string;
  progress?: number;
  progressLabel?: string;
  isMoney?: boolean;
  moneyAmount?: number;
  moneyCurrency?: string;
  locale: string;
}

function KpiCard({
  icon, label, value, sub, loading, gradient, iconBg, href, pulse,
  sparkData, sparkColor, progress, progressLabel, isMoney,
  moneyAmount, moneyCurrency, locale,
}: KpiCardProps) {
  const inner = (
    <div className={cn(
      "group relative overflow-hidden rounded-2xl p-5 shadow-md transition-all duration-300",
      gradient,
      href && "cursor-pointer hover:-translate-y-0.5 hover:shadow-xl",
    )}>
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-black/10 blur-xl" />

      {/* Sparkline bg */}
      {sparkData && sparkColor && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 opacity-40">
          <Sparkline data={sparkData} color={sparkColor} className="h-full w-full" />
        </div>
      )}

      <div className="relative flex items-start justify-between">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl shadow", iconBg)}>
          {icon}
        </span>
        <div className="flex items-center gap-2">
          {pulse && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
          )}
          {href && <ArrowRight className="h-4 w-4 text-white/50 opacity-0 transition-opacity group-hover:opacity-100" />}
        </div>
      </div>

      <div className="relative mt-4">
        {loading ? (
          <>
            <Sk className="mb-2 h-9 w-24 bg-white/20" />
            <Sk className="h-3.5 w-32 bg-white/15" />
          </>
        ) : (
          <>
            <p className="text-3xl font-bold tracking-tight text-white">
              {isMoney && moneyAmount !== undefined && moneyCurrency
                ? formatMoney({ amount: moneyAmount, currency: moneyCurrency }, locale)
                : value !== null
                  ? <CountUp value={value} locale={locale} />
                  : "—"}
            </p>
            <p className="mt-1 text-sm font-medium text-white/90">{label}</p>
            {sub && <p className="mt-0.5 text-xs text-white/75">{sub}</p>}
            {progress !== undefined && (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-white/70 transition-all duration-700" style={{ width: `${progress}%` }} />
                </div>
                {progressLabel && <p className="mt-1 text-[10px] text-white/70">{progressLabel}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
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
  icon,
  label,
  desc,
  gradient,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  gradient: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
    >
      {/* Top gradient stripe */}
      <div className={cn("absolute inset-x-0 top-0 h-1 rounded-t-2xl", gradient)} />

      <div className="flex items-start justify-between pt-1">
        <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-110", gradient, "shadow-sm")}>
          {icon}
        </span>
        {badge !== undefined && badge > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </div>
      <div>
        <p className="font-semibold">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="flex items-center gap-1 text-xs font-medium text-primary">
        Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

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
      <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {icon}
        {title}
      </h2>
      {action}
    </div>
  );
}

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
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight">
              {greeting}, {session?.user.fullName?.split(" ")[0] ?? "—"} 👋
            </h1>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {planName && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 px-3 py-1 text-xs font-bold text-white shadow-sm">
              <Sparkles className="h-3 w-3" />
              {planName}
            </span>
          )}
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:bg-muted"
            title="Refresh"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      <SubscriptionBanner />

      {/* ── KPI Cards — up to 8, 4-per-row ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {can("student.read") && (
          <KpiCard
            icon={<GraduationCap className="h-5 w-5 text-white" />}
            label={t("kpi.students")}
            value={studentsTotal}
            sub={t("kpi.activeStudents")}
            loading={ldPeople}
            gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
            iconBg="bg-white/20"
            href="/students"
            locale={locale}
            progress={studentLimit && studentsTotal !== null ? Math.round((studentsTotal / studentLimit) * 100) : undefined}
            progressLabel={studentLimit ? `${studentLimit - (studentsTotal ?? 0)} slots remaining` : undefined}
          />
        )}
        {can("teacher.read") && (
          <KpiCard
            icon={<Users className="h-5 w-5 text-white" />}
            label={t("kpi.teachers")}
            value={teachersTotal}
            sub={t("kpi.totalTeachers")}
            loading={ldPeople}
            gradient="bg-gradient-to-br from-violet-500 to-purple-600"
            iconBg="bg-white/20"
            href="/teachers"
            locale={locale}
            progress={teacherLimit && teachersTotal !== null ? Math.round((teachersTotal / teacherLimit) * 100) : undefined}
            progressLabel={teacherLimit ? `${teacherLimit - (teachersTotal ?? 0)} slots remaining` : undefined}
          />
        )}
        {(can("schedule.read") || can("attendance.read")) && (
          <KpiCard
            icon={<CalendarDays className="h-5 w-5 text-white" />}
            label={t("kpi.sessionsThisWeek")}
            value={ldWeek ? null : (weekSessions?.length ?? 0)}
            sub={t("kpi.sessionsThisWeekSub")}
            loading={ldWeek}
            gradient="bg-gradient-to-br from-cyan-500 to-sky-600"
            iconBg="bg-white/20"
            href="/calendar"
            locale={locale}
          />
        )}
        {(can("attendance.record") || can("attendance.read")) && (
          <KpiCard
            icon={<ClipboardCheck className="h-5 w-5 text-white" />}
            label={t("kpi.pendingAttendance")}
            value={ldAttend ? null : pendingCount}
            sub={t("kpi.sessionsNeedAttendance")}
            loading={ldAttend}
            gradient={pendingCount > 0 ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-slate-500 to-slate-600"}
            iconBg="bg-white/20"
            href="/attendance"
            pulse={pendingCount > 0}
            locale={locale}
          />
        )}
        {can("invoice.view") && (
          <KpiCard
            icon={<ReceiptText className="h-5 w-5 text-white" />}
            label={t("kpi.openInvoices")}
            value={ldInv ? null : openInvoices}
            sub={t("kpi.awaitingPayment")}
            loading={ldInv}
            gradient={openInvoices > 0 ? "bg-gradient-to-br from-sky-500 to-blue-600" : "bg-gradient-to-br from-slate-500 to-slate-600"}
            iconBg="bg-white/20"
            href="/invoices"
            pulse={openInvoices > 0}
            locale={locale}
          />
        )}
        {can("invoice.view") && bucket && (
          <KpiCard
            icon={<Wallet className="h-5 w-5 text-white" />}
            label={t("finance.collected")}
            value={null}
            isMoney
            moneyAmount={bucket.collected_minor}
            moneyCurrency={bucket.currency}
            sub={`${collectionRate}% ${t("kpi.collectionRate")}`}
            loading={ldInv}
            gradient="bg-gradient-to-br from-teal-500 to-emerald-600"
            iconBg="bg-white/20"
            href="/invoices"
            sparkData={revSparkData.length > 0 ? revSparkData : undefined}
            sparkColor="#ffffff"
            locale={locale}
          />
        )}
        {can("invoice.view") && bucket && (
          <KpiCard
            icon={<BarChart3 className="h-5 w-5 text-white" />}
            label={t("finance.billed")}
            value={null}
            isMoney
            moneyAmount={bucket.billed_minor}
            moneyCurrency={bucket.currency}
            sub={t("kpi.totalBilledSub")}
            loading={ldInv}
            gradient="bg-gradient-to-br from-indigo-500 to-violet-600"
            iconBg="bg-white/20"
            href="/financial-statistics"
            locale={locale}
          />
        )}
        {can("invoice.view") && bucket && bucket.outstanding_minor > 0 && (
          <KpiCard
            icon={<Clock className="h-5 w-5 text-white" />}
            label={t("finance.outstanding")}
            value={null}
            isMoney
            moneyAmount={bucket.outstanding_minor}
            moneyCurrency={bucket.currency}
            sub={t("kpi.outstandingSub")}
            loading={ldInv}
            gradient="bg-gradient-to-br from-rose-500 to-pink-600"
            iconBg="bg-white/20"
            href="/invoices"
            pulse
            locale={locale}
          />
        )}
        {/* Total hours this month — for a teacher, only hours actually taught so far */}
        {(can("schedule.read") || can("attendance.read")) && (
          <KpiCard
            icon={<Timer className="h-5 w-5 text-white" />}
            label={t("kpi.hoursThisMonth")}
            value={ldMonth ? null : hoursMonth}
            sub={ldMonth ? "" : `${minsMonth}m · ${t(isTeacher ? "kpi.hoursThisMonthSubTaught" : "kpi.hoursThisMonthSub")}`}
            loading={ldMonth}
            gradient="bg-gradient-to-br from-orange-500 to-red-600"
            iconBg="bg-white/20"
            href="/calendar"
            locale={locale}
          />
        )}
        {/* Teacher earnings so far this month */}
        {can("payout.read_own") && (
          <KpiCard
            icon={<Wallet className="h-5 w-5 text-white" />}
            label={t("kpi.earningsThisMonth")}
            value={!ldEarnings && myEarnings?.currency == null ? (myEarnings?.amount ?? 0) : null}
            isMoney={!ldEarnings && myEarnings?.currency != null}
            moneyAmount={myEarnings?.amount ?? 0}
            moneyCurrency={myEarnings?.currency ?? undefined}
            sub={t("kpi.earningsThisMonthSub")}
            loading={ldEarnings}
            gradient="bg-gradient-to-br from-emerald-500 to-green-600"
            iconBg="bg-white/20"
            href="/payroll"
            locale={locale}
          />
        )}
        {/* Total due per currency across all bills (all-time owed) */}
        {can("invoice.view") && !ldInv && dueByCurrency.map((m) => (
          <KpiCard
            key={`due-${m.currency}`}
            icon={<ReceiptText className="h-5 w-5 text-white" />}
            label={`${t("kpi.totalDue")} · ${m.currency}`}
            value={null}
            isMoney
            moneyAmount={m.due_minor}
            moneyCurrency={m.currency}
            sub={t("kpi.totalDueSub")}
            loading={false}
            gradient="bg-gradient-to-br from-fuchsia-500 to-purple-700"
            iconBg="bg-white/20"
            href="/invoices"
            pulse
            locale={locale}
          />
        ))}
        {/* Total teacher salaries this month, per currency */}
        {can("payout.read") && !ldProfit && salariesByCurrency.map((r) => (
          <KpiCard
            key={`salary-${r.currency}`}
            icon={<Wallet className="h-5 w-5 text-white" />}
            label={`${t("kpi.teacherSalaries")} · ${r.currency}`}
            value={null}
            isMoney
            moneyAmount={r.payouts_minor}
            moneyCurrency={r.currency}
            sub={t("kpi.teacherSalariesSub")}
            loading={false}
            gradient="bg-gradient-to-br from-rose-500 to-pink-600"
            iconBg="bg-white/20"
            href="/payroll"
            locale={locale}
          />
        ))}
        {/* Net profit after teacher salaries this month, per currency */}
        {can("payout.read") && !ldProfit && profitByCurrency.map((r) => (
          <KpiCard
            key={`profit-${r.currency}`}
            icon={<BarChart3 className="h-5 w-5 text-white" />}
            label={`${t("kpi.netProfit")} · ${r.currency}`}
            value={null}
            isMoney
            moneyAmount={r.profit_minor}
            moneyCurrency={r.currency}
            sub={t("kpi.netProfitSub")}
            loading={false}
            gradient={r.profit_minor >= 0
              ? "bg-gradient-to-br from-emerald-500 to-green-600"
              : "bg-gradient-to-br from-rose-500 to-red-600"}
            iconBg="bg-white/20"
            href="/financial-statistics"
            locale={locale}
          />
        ))}
      </div>

      {/* ── Quick Actions — directly below KPI cards ── */}
      <div className="space-y-4">
        <SectionHeader icon={<Sparkles className="h-4 w-4" />} title={t("actions.title")} />
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {can("student.create") && (
            <ActionCard
              href="/students"
              icon={<GraduationCap className="h-6 w-6 text-white" />}
              label={t("actions.addStudent")}
              desc={t("actions.addStudentDesc")}
              gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
            />
          )}
          {(can("attendance.record") || can("attendance.read")) && (
            <ActionCard
              href="/attendance"
              icon={<ClipboardCheck className="h-6 w-6 text-white" />}
              label={t("actions.markAttendance")}
              desc={t("actions.markAttendanceDesc")}
              gradient="bg-gradient-to-br from-amber-500 to-orange-600"
              badge={pendingCount}
            />
          )}
          {can("invoice.view") && (
            <ActionCard
              href="/invoices"
              icon={<ReceiptText className="h-6 w-6 text-white" />}
              label={t("actions.viewInvoices")}
              desc={t("actions.viewInvoicesDesc")}
              gradient="bg-gradient-to-br from-sky-500 to-blue-600"
              badge={openInvoices}
            />
          )}
          {can("schedule.read") && (
            <ActionCard
              href="/calendar"
              icon={<CalendarDays className="h-6 w-6 text-white" />}
              label={t("actions.viewCalendar")}
              desc={t("actions.viewCalendarDesc")}
              gradient="bg-gradient-to-br from-violet-500 to-purple-600"
            />
          )}
          {can("payout.read") && (
            <ActionCard
              href="/payroll"
              icon={<Wallet className="h-6 w-6 text-white" />}
              label={t("actions.payroll")}
              desc={t("actions.payrollDesc")}
              gradient="bg-gradient-to-br from-rose-500 to-pink-600"
            />
          )}
          {can("payout.read_own") && !can("payout.read") && (
            <ActionCard
              href="/payroll"
              icon={<Wallet className="h-6 w-6 text-white" />}
              label={t("actions.myPayroll")}
              desc={t("actions.myPayrollDesc")}
              gradient="bg-gradient-to-br from-rose-500 to-pink-600"
            />
          )}
          {can("invoice.view") && (
            <ActionCard
              href="/financial-statistics"
              icon={<BarChart3 className="h-6 w-6 text-white" />}
              label={t("actions.financialStats")}
              desc={t("actions.financialStatsDesc")}
              gradient="bg-gradient-to-br from-indigo-500 to-blue-700"
            />
          )}
          {can("student.read") && (
            <ActionCard
              href="/sessions"
              icon={<BookOpen className="h-6 w-6 text-white" />}
              label={t("actions.sessions")}
              desc={t("actions.sessionsDesc")}
              gradient="bg-gradient-to-br from-cyan-500 to-teal-600"
            />
          )}
        </div>
      </div>

      {/* ── Charts row ── */}
      {(can("invoice.view") || can("payout.read")) && (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Revenue vs Payouts bar chart */}
          <div className="lg:col-span-3 rounded-2xl border bg-card p-5 shadow-sm">
            <SectionHeader
              icon={<BarChart3 className="h-4 w-4" />}
              title={t("finance.revenueChart")}
              action={
                <Link href="/financial-statistics" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  {t("finance.viewAll")} <ArrowRight className="h-3 w-3" />
                </Link>
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
                  No data available
                </div>
              )}
            </div>

            {/* Summary strip */}
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

          {/* Donut + gauge */}
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <SectionHeader
                icon={<ReceiptText className="h-4 w-4" />}
                title={t("finance.invoiceBreakdown")}
              />
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
              <div className="rounded-2xl border bg-card p-5 shadow-sm">
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
      )}

      {/* ── Weekly sessions + Pending list ── */}
      {(can("schedule.read") || can("attendance.read") || can("attendance.record")) && (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Weekly sessions chart */}
          {(can("schedule.read") || can("attendance.read")) && (
            <div className="lg:col-span-2 rounded-2xl border bg-card p-5 shadow-sm">
              <SectionHeader
                icon={<CalendarDays className="h-4 w-4" />}
                title={t("week.title")}
                action={
                  <Link href="/calendar" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {t("week.viewCalendar")} <ArrowRight className="h-3 w-3" />
                  </Link>
                }
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
                    { label: "Total", val: weekSessions.length, color: "text-foreground" },
                    { label: "Done", val: weekSessions.filter(s => s.status === "ATTENDED" || s.status === "ABSENT_EXCUSED" || s.status === "ABSENT_UNEXCUSED").length, color: "text-emerald-600" },
                    { label: "Pending", val: weekSessions.filter(s => s.status === "SCHEDULED").length, color: "text-blue-500" },
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

          {/* Pending attendance */}
          {(can("attendance.record") || can("attendance.read")) && (
            <div className={cn("space-y-4", can("schedule.read") || can("attendance.read") ? "lg:col-span-3" : "lg:col-span-5")}>
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
                    <Link href="/attendance" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      {t("pending.viewAll")} <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                }
              />

              <div className="space-y-2">
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
      )}

      {/* ── This Week's Trials ── */}
      {can("student.read") && (can("schedule.read") || can("attendance.read")) && (
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <SectionHeader
            icon={<FlaskConical className="h-4 w-4" />}
            title={t("trials.title")}
            action={
              <Link href="/students?tab=trials" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {t("trials.viewAll")} <ArrowRight className="h-3 w-3" />
              </Link>
            }
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
                  {formatNumber(trialLessonsThisWeek.filter(s => s.status === "ATTENDED").length, locale)} ✓
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Plan usage with ring gauges ── */}
      {!isTeacher && !isSuperAdmin && !ldPlan && entitlements && (
        (studentLimit !== null || teacherLimit !== null) && (
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <SectionHeader icon={<Sparkles className="h-4 w-4" />} title={t("plan.usage")} />
              <Link
                href="/plan"
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {t("plan.managePlan")} <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-12">
              {studentLimit !== null && (
                <RingGauge
                  value={studentUsage}
                  max={studentLimit}
                  color="#10b981"
                  label={t("plan.students")}
                  locale={locale}
                />
              )}
              {teacherLimit !== null && (
                <RingGauge
                  value={teacherUsage}
                  max={teacherLimit}
                  color="#8b5cf6"
                  label={t("plan.teachers")}
                  locale={locale}
                />
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
