"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  DoorOpen,
  FileText,
  Gauge,
  Link2Off,
  Loader2,
  Search,
  ShieldAlert,
  Trophy,
  UserCheck,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StatusChip } from "@/components/admin/status-chip";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { UserAvatar } from "@/components/admin/user-avatar";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import {
  ApiError,
  getTeacherInsights,
  type InsightScores,
  type InsightTeacher,
  type TeacherInsights as Insights,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  attendanceSegments,
  fmtRate,
  joinSegments,
  rateText,
  reportSegments,
  ScoreRing,
  SplitBar,
  SplitLegend,
  TIER_CHIP,
  tierOf,
  useDuration,
  type Segment,
} from "./insight-ui";
import { TeacherInsightDetail } from "./teacher-insight-detail";

/**
 * Teacher performance: for a period, how every teacher enters their lessons, files their reports
 * and shows up — read from the Enter button, the report log and attendance, never typed in.
 *
 * Built to be traced, like the Supervision page: every percentage sits beside the counts it is
 * made of, and a teacher's row opens the lessons behind it, so "reports on time 62%" can always be
 * followed down to the reports that were late.
 */

type PeriodKey = "week" | "month" | "last30" | "last90";
type SortKey = "score" | "name" | "join" | "joinDelay" | "reports" | "reportDelay" | "attendance" | "lessons";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const LATE_OPTIONS = [0, 5, 10, 15] as const;
const REPORT_OPTIONS = [60, 120, 360, 1440] as const;

/** Decided lessons a teacher needs before they can headline a highlight card. */
const HIGHLIGHT_MIN = 3;

/** A delay is better when smaller, a name reads A→Z; everything else is better when bigger. */
const ASC_FIRST = new Set<SortKey>(["name", "joinDelay", "reportDelay"]);

/** Local calendar date as Y-m-d — the API reads the academy's own days. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function periodRange(key: PeriodKey): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  const shift = (days: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  switch (key) {
    case "week": {
      // Weeks start on Saturday here, as the academies' timetables do.
      const back = (now.getDay() + 1) % 7;
      return { from: shift(-back), to: today };
    }
    case "month":
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "last30":
      return { from: shift(-29), to: today };
    case "last90":
      return { from: shift(-89), to: today };
  }
}

function sortValue(te: InsightTeacher, key: SortKey): number | string | null {
  switch (key) {
    case "score":
      return te.score;
    case "name":
      return te.name;
    case "join":
      return te.join.on_time_rate;
    case "joinDelay":
      return te.join.avg_delay_minutes;
    case "reports":
      return te.reports.on_time_rate;
    case "reportDelay":
      return te.reports.avg_delay_minutes;
    case "attendance":
      return te.attendance.teacher_attendance_rate;
    case "lessons":
      return te.attendance.lessons;
  }
}

export function TeacherInsights() {
  const t = useTranslations("teacherInsights");
  const locale = useLocale();
  const dur = useDuration();
  const list = useMemo(() => new Intl.ListFormat(locale, { style: "short", type: "conjunction" }), [locale]);

  const [period, setPeriod] = useState<PeriodKey | "custom">("last30");
  const [range, setRange] = useState(() => periodRange("last30"));
  const [lateMinutes, setLateMinutes] = useState<number>(5);
  const [reportMinutes, setReportMinutes] = useState<number>(120);
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "score", dir: "desc" });
  const [selected, setSelected] = useState<InsightTeacher | null>(null);

  // Filters change faster than the server answers — only the latest request may land.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getTeacherInsights({
        from: range.from,
        to: range.to,
        late_minutes: lateMinutes,
        report_minutes: reportMinutes,
      });
      if (ticket === latest.current) setData(next);
    } catch (e) {
      if (ticket === latest.current) setError(e instanceof ApiError ? e.message : t("loadError"));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [range.from, range.to, lateMinutes, reportMinutes, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const teachers = useMemo(() => data?.teachers ?? [], [data]);

  // Rank is by score and stays put while the table is re-sorted by another column.
  const rankOf = useMemo(() => {
    const scored = teachers
      .filter((te) => te.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
    return new Map(scored.map((te, i) => [te.id, i + 1]));
  }, [teachers]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const list = q ? teachers.filter((te) => te.name.toLocaleLowerCase().includes(q)) : [...teachers];
    const sign = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      // Nothing to measure sorts last whichever way the column points.
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return cmp * sign || a.name.localeCompare(b.name);
    });
  }, [teachers, query, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: ASC_FIRST.has(key) ? "asc" : "desc" },
    );

  const totals = data?.totals;
  const first = loading && !data;
  const taught = teachers.filter((te) => te.attendance.lessons > 0).length;
  const noLink = teachers.filter((te) => te.is_active && !te.has_meeting_url);
  const params = { from: range.from, to: range.to, late_minutes: lateMinutes, report_minutes: reportMinutes };

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors focus:ring-3";

  return (
    <div className="space-y-6" data-testid="teacher-insights">
      <PageHero
        icon={Gauge}
        title={t("title")}
        subtitle={t("subtitle")}
        latticeId="teacher-insights-hero"
        actions={loading ? <Loader2 className="size-5 animate-spin text-white/80" aria-hidden /> : undefined}
      />

      {/* ── Period + thresholds ─────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm" data-testid="insights-filters">
        <Segmented
          label={t("periodLabel")}
          options={(["week", "month", "last30", "last90"] as const).map((key) => ({
            value: key,
            label: t(`period.${key}`),
            testId: `insights-period-${key}`,
          }))}
          value={period}
          onChange={(key) => {
            setPeriod(key);
            setRange(periodRange(key));
          }}
        />
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("from")}</span>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              if (!e.target.value) return;
              setPeriod("custom");
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("to")}</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              if (!e.target.value) return;
              setPeriod("custom");
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
            className={inputClass}
          />
        </label>
        <span className="bg-border hidden h-6 w-px lg:block" aria-hidden />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("lateAfter")}</span>
          <Segmented
            label={t("lateAfter")}
            options={LATE_OPTIONS.map((n) => ({ value: n, label: t("dur.min", { n }), testId: `insights-late-${n}` }))}
            value={lateMinutes}
            onChange={setLateMinutes}
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("reportWithin")}</span>
          <Segmented
            label={t("reportWithin")}
            options={REPORT_OPTIONS.map((n) => ({ value: n, label: t("dur.h", { h: n / 60 }), testId: `insights-report-${n}` }))}
            value={reportMinutes}
            onChange={setReportMinutes}
          />
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* ── The academy in four numbers ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreKpi totals={totals} teachersTaught={taught} loading={first} />
        <KpiCard
          icon={DoorOpen}
          label={t("kpi.enter")}
          value={fmtRate(totals?.join.on_time_rate ?? null)}
          valueClass={rateText(totals?.join.on_time_rate ?? null)}
          sub={
            totals && totals.join.measured > 0
              ? t("kpi.enterSub", { on_time: totals.join.on_time, measured: totals.join.measured, avg: dur(totals.join.avg_delay_minutes) })
              : t("kpi.enterEmpty")
          }
          segments={totals ? joinSegments(totals, t) : undefined}
          loading={first}
          testId="kpi-enter"
        />
        <KpiCard
          icon={FileText}
          label={t("kpi.reports")}
          value={fmtRate(totals?.reports.on_time_rate ?? null)}
          valueClass={rateText(totals?.reports.on_time_rate ?? null)}
          sub={
            totals && totals.reports.due > 0
              ? t("kpi.reportsSub", { on_time: totals.reports.on_time, due: totals.reports.due, avg: dur(totals.reports.avg_delay_minutes) })
              : t("kpi.reportsEmpty")
          }
          segments={totals ? reportSegments(totals, t) : undefined}
          loading={first}
          testId="kpi-reports"
        />
        <KpiCard
          icon={UserCheck}
          label={t("kpi.attendance")}
          value={fmtRate(totals?.attendance.teacher_attendance_rate ?? null)}
          valueClass={rateText(totals?.attendance.teacher_attendance_rate ?? null)}
          sub={
            totals && totals.attendance.lessons > 0
              ? t("kpi.attendanceSub", {
                  absent: totals.attendance.teacher_absent,
                  student: fmtRate(totals.attendance.student_attendance_rate),
                })
              : t("kpi.attendanceEmpty")
          }
          segments={totals ? attendanceSegments(totals, t) : undefined}
          loading={first}
          testId="kpi-attendance"
        />
      </div>

      {noLink.length > 0 && (
        <p
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="insights-no-link"
        >
          <Link2Off className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("noLinkBanner", { n: noLink.length })}
            <span className="text-amber-700/80 dark:text-amber-300/80 ms-1">
              {list.format(noLink.slice(0, 4).map((te) => te.name))}
              {noLink.length > 4 ? ` +${noLink.length - 4}` : ""}
            </span>
          </span>
        </p>
      )}

      {data && <Highlights teachers={teachers} onOpen={setSelected} />}

      {/* ── Every teacher ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Users className="text-muted-foreground size-4" aria-hidden />
              {t("table.title")}
              {data && <span className="text-muted-foreground text-xs font-normal tabular-nums">{teachers.length}</span>}
            </h2>
            <p className="text-muted-foreground text-xs">{t("table.hint")}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label className="relative min-w-full flex-1 sm:min-w-0 sm:flex-none">
              <span className="sr-only">{t("table.search")}</span>
              <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("table.search")}
                className={cn(inputClass, "w-full ps-8 sm:w-56")}
                data-testid="insights-search"
              />
            </label>
            {/* Phones have no column headers to click. */}
            <label className="flex items-center gap-1.5 text-xs sm:hidden">
              <span className="text-muted-foreground">{t("table.sortBy")}</span>
              <select
                value={sort.key}
                onChange={(e) => {
                  const key = e.target.value as SortKey;
                  setSort({ key, dir: ASC_FIRST.has(key) ? "asc" : "desc" });
                }}
                className={inputClass}
              >
                {(["score", "join", "reports", "attendance", "joinDelay", "reportDelay", "lessons", "name"] as const).map((key) => (
                  <option key={key} value={key}>
                    {t(`table.sort.${key}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {data && teachers.length === 0 ? (
          <TableCard>
            <p className="text-muted-foreground px-4 py-10 text-center text-sm">{t("table.empty")}</p>
          </TableCard>
        ) : (
          <>
            {/* Phone: one card per teacher. */}
            <ul className="space-y-2 sm:hidden" data-testid="insights-cards">
              {first
                ? [0, 1, 2].map((i) => <li key={i} className="bg-card h-36 animate-pulse rounded-xl ring-1 ring-foreground/[0.06]" />)
                : rows.map((te) => (
                    <TeacherCard key={te.id} teacher={te} rank={rankOf.get(te.id) ?? null} onOpen={() => setSelected(te)} />
                  ))}
            </ul>

            {/* Tablet and up: the full table. */}
            <TableCard className="hidden sm:block" testId="insights-table">
              <table className="w-full text-sm">
                <thead>
                  <tr className={TR_HEAD}>
                    <Th className="w-12 text-center">#</Th>
                    <SortTh k="name" sort={sort} onSort={toggleSort}>{t("table.teacher")}</SortTh>
                    <SortTh k="score" sort={sort} onSort={toggleSort} className="text-center">{t("table.score")}</SortTh>
                    <SortTh k="join" sort={sort} onSort={toggleSort}>{t("table.enter")}</SortTh>
                    <SortTh k="joinDelay" sort={sort} onSort={toggleSort} className="text-end">{t("table.avgEnter")}</SortTh>
                    <SortTh k="reports" sort={sort} onSort={toggleSort}>{t("table.reports")}</SortTh>
                    <SortTh k="reportDelay" sort={sort} onSort={toggleSort} className="text-end">{t("table.avgReport")}</SortTh>
                    <SortTh k="attendance" sort={sort} onSort={toggleSort}>{t("table.attendance")}</SortTh>
                    <SortTh k="lessons" sort={sort} onSort={toggleSort} className="text-end">{t("table.lessons")}</SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {first
                    ? [0, 1, 2, 3].map((i) => (
                        <tr key={i}>
                          <Td colSpan={9}>
                            <div className="bg-muted h-8 animate-pulse rounded-md" />
                          </Td>
                        </tr>
                      ))
                    : rows.map((te) => (
                        <TeacherRow key={te.id} teacher={te} rank={rankOf.get(te.id) ?? null} onOpen={() => setSelected(te)} />
                      ))}
                  {!first && rows.length === 0 && (
                    <tr>
                      <Td colSpan={9} className="text-muted-foreground py-8 text-center">
                        {t("table.noMatch")}
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableCard>
          </>
        )}
      </section>

      {/* ── How it's measured ───────────────────────────────────────────── */}
      <details className="bg-card group rounded-xl p-4 text-sm shadow-sm ring-1 ring-foreground/[0.06]" data-testid="insights-how">
        <summary className="cursor-pointer select-none font-semibold">{t("how.title")}</summary>
        <ul className="text-muted-foreground mt-3 list-disc space-y-1.5 ps-5 text-xs leading-relaxed">
          <li>{t("how.enter", { late: data?.thresholds.late_minutes ?? lateMinutes, opens: data?.thresholds.opens_minutes_before ?? 10 })}</li>
          <li>{t("how.reports", { within: dur(data?.thresholds.report_minutes ?? reportMinutes) })}</li>
          <li>{t("how.attendance")}</li>
          <li>{t("how.score")}</li>
          {totals && totals.attendance.unmarked > 0 && (
            <li className="text-amber-700 dark:text-amber-400">{t("how.unmarked", { n: totals.attendance.unmarked })}</li>
          )}
        </ul>
      </details>

      {selected && (
        <TeacherInsightDetail teacher={selected} params={params} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Segmented<V extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: V; label: string; testId?: string }[];
  value: V | "custom";
  onChange: (v: V) => void;
}) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          data-testid={o.testId}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  valueClass,
  sub,
  segments,
  loading,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  valueClass?: string;
  sub: ReactNode;
  segments?: Segment[];
  loading: boolean;
  testId: string;
}) {
  return (
    <div className="bg-card flex min-w-0 flex-col rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground truncate text-xs font-medium">{label}</span>
        <Icon className="text-muted-foreground/70 size-4 shrink-0" aria-hidden />
      </div>
      {loading ? (
        <div className="bg-muted mt-2 h-8 w-20 animate-pulse rounded-md" aria-hidden />
      ) : (
        <p className={cn("mt-1.5 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl", valueClass)} dir="ltr">
          {value}
        </p>
      )}
      <p className="text-muted-foreground mt-0.5 text-xs">{loading ? " " : sub}</p>
      {segments && (
        <div className="mt-auto space-y-2 pt-3">
          <SplitBar segments={segments} />
          <SplitLegend segments={segments} />
        </div>
      )}
    </div>
  );
}

function ScoreKpi({
  totals,
  teachersTaught,
  loading,
}: {
  totals: InsightScores | undefined;
  teachersTaught: number;
  loading: boolean;
}) {
  const t = useTranslations("teacherInsights");
  const score = totals?.score ?? null;
  const tier = tierOf(score);

  return (
    <div
      className="bg-card relative flex min-w-0 items-center gap-4 overflow-hidden rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]"
      data-testid="kpi-score"
    >
      <div className="bg-primary/5 pointer-events-none absolute -end-10 -top-10 size-32 rounded-full" aria-hidden />
      {loading ? (
        <div className="bg-muted size-[72px] shrink-0 animate-pulse rounded-full" aria-hidden />
      ) : (
        <ScoreRing score={score} size={72} stroke={6} />
      )}
      <div className="relative min-w-0">
        <p className="text-muted-foreground text-xs font-medium">{t("kpi.score")}</p>
        {tier && !loading && (
          <StatusChip tone={TIER_CHIP[tier]} className="mt-1">
            {t(`tier.${tier}`)}
          </StatusChip>
        )}
        <p className="text-muted-foreground mt-1.5 text-xs">
          {loading ? " " : t("kpi.scoreSub", { n: teachersTaught })}
        </p>
      </div>
    </div>
  );
}

/**
 * Three cards a head of teachers reads first: who enters on time, who reports fastest, and who
 * needs a conversation. A teacher needs a few decided lessons to qualify — one lucky lesson is not
 * a record.
 */
function Highlights({ teachers, onOpen }: { teachers: InsightTeacher[]; onOpen: (te: InsightTeacher) => void }) {
  const t = useTranslations("teacherInsights");
  const dur = useDuration();

  const punctual = pickBest(
    teachers.filter((te) => te.join.measured >= HIGHLIGHT_MIN && te.join.on_time_rate !== null),
    (a, b) => (b.join.on_time_rate ?? 0) - (a.join.on_time_rate ?? 0) || (a.join.avg_delay_minutes ?? 0) - (b.join.avg_delay_minutes ?? 0),
  );
  const fastest = pickBest(
    teachers.filter((te) => te.reports.filed >= HIGHLIGHT_MIN && te.reports.avg_delay_minutes !== null),
    (a, b) => (a.reports.avg_delay_minutes ?? 0) - (b.reports.avg_delay_minutes ?? 0) || (b.reports.on_time_rate ?? 0) - (a.reports.on_time_rate ?? 0),
  );
  const lowest = pickBest(
    teachers.filter((te) => te.score !== null && te.attendance.lessons >= HIGHLIGHT_MIN),
    (a, b) => (a.score ?? 0) - (b.score ?? 0),
  );
  const attention = lowest && (lowest.score ?? 100) < 75 ? lowest : null;

  if (!punctual && !fastest && !lowest) return null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="insights-highlights">
      <HighlightCard
        icon={Trophy}
        tone="good"
        title={t("highlights.punctual")}
        teacher={punctual}
        metric={punctual ? t("highlights.punctualMetric", { rate: fmtRate(punctual.join.on_time_rate), avg: dur(punctual.join.avg_delay_minutes) }) : null}
        empty={t("highlights.notEnough")}
        onOpen={onOpen}
        testId="highlight-punctual"
      />
      <HighlightCard
        icon={Zap}
        tone="info"
        title={t("highlights.fastest")}
        teacher={fastest}
        metric={fastest ? t("highlights.fastestMetric", { avg: dur(fastest.reports.avg_delay_minutes), rate: fmtRate(fastest.reports.on_time_rate) }) : null}
        empty={t("highlights.notEnough")}
        onOpen={onOpen}
        testId="highlight-fastest"
      />
      <HighlightCard
        icon={ShieldAlert}
        tone={attention ? "crit" : "good"}
        title={t("highlights.attention")}
        teacher={attention}
        metric={attention ? t("highlights.attentionMetric", { score: Math.round(attention.score ?? 0) }) : null}
        empty={lowest ? t("highlights.allGood") : t("highlights.notEnough")}
        onOpen={onOpen}
        testId="highlight-attention"
      />
    </div>
  );
}

function pickBest(list: InsightTeacher[], cmp: (a: InsightTeacher, b: InsightTeacher) => number): InsightTeacher | null {
  return [...list].sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name))[0] ?? null;
}

const HIGHLIGHT_TONE = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  crit: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
} as const;

function HighlightCard({
  icon: Icon,
  tone,
  title,
  teacher,
  metric,
  empty,
  onOpen,
  testId,
}: {
  icon: LucideIcon;
  tone: keyof typeof HIGHLIGHT_TONE;
  title: string;
  teacher: InsightTeacher | null;
  metric: string | null;
  empty: string;
  onOpen: (te: InsightTeacher) => void;
  testId: string;
}) {
  const body = (
    <>
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", HIGHLIGHT_TONE[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 text-start">
        <span className="text-muted-foreground block text-[11px] font-semibold uppercase tracking-wide">{title}</span>
        {teacher ? (
          <>
            <span className="block truncate text-sm font-bold">{teacher.name}</span>
            <span className="text-muted-foreground block truncate text-xs">{metric}</span>
          </>
        ) : (
          <span className="text-muted-foreground block text-xs">{empty}</span>
        )}
      </span>
    </>
  );
  const base = "bg-card flex min-w-0 items-center gap-3 rounded-xl p-3.5 shadow-sm ring-1 ring-foreground/[0.06]";

  return teacher ? (
    <button
      type="button"
      onClick={() => onOpen(teacher)}
      className={cn(base, "transition-shadow hover:shadow-md focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-2")}
      data-testid={testId}
    >
      {body}
    </button>
  ) : (
    <div className={base} data-testid={testId}>
      {body}
    </div>
  );
}

function SortTh({
  k,
  sort,
  onSort,
  className,
  children,
}: {
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  className?: string;
  children: ReactNode;
}) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  const align = className?.includes("text-end") ? "justify-end" : className?.includes("text-center") ? "justify-center" : "justify-start";
  return (
    <Th className={cn("whitespace-nowrap", className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("inline-flex w-full items-center gap-1 uppercase tracking-wide", align, active && "text-foreground")}
        data-testid={`insights-sort-${k}`}
      >
        {children}
        <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
        {active && <span className="sr-only">{sort.dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </Th>
  );
}

/** A rate, the counts behind it, and the split — the same three lines in every column. */
function RateCell({
  rate,
  part,
  whole,
  segments,
  empty,
}: {
  rate: number | null;
  part: number;
  whole: number;
  segments: Segment[];
  empty?: ReactNode;
}) {
  if (whole === 0 && empty) return <>{empty}</>;
  return (
    <div className="min-w-[7.5rem]">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("font-semibold tabular-nums", rateText(rate))}>{fmtRate(rate)}</span>
        <span className="text-muted-foreground text-[11px] tabular-nums" dir="ltr">
          {whole > 0 ? `${part}/${whole}` : ""}
        </span>
      </div>
      <SplitBar className="mt-1.5" segments={segments} />
    </div>
  );
}

function TeacherName({ teacher }: { teacher: InsightTeacher }) {
  const t = useTranslations("teacherInsights");
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <UserAvatar name={teacher.name} />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{teacher.name}</span>
        <span className="mt-0.5 flex flex-wrap gap-1">
          {!teacher.is_active && <StatusChip tone="neutral">{t("chips.inactive")}</StatusChip>}
          {teacher.is_active && !teacher.has_meeting_url && (
            <StatusChip tone="warn" icon={Link2Off}>
              {t("chips.noLink")}
            </StatusChip>
          )}
        </span>
      </span>
    </span>
  );
}

function TeacherRow({ teacher: te, rank, onOpen }: { teacher: InsightTeacher; rank: number | null; onOpen: () => void }) {
  const t = useTranslations("teacherInsights");
  const dur = useDuration();
  // The teacher showed up whenever the lesson went ahead — a student no-show included.
  const showedUp = te.attendance.attended + te.attendance.free + te.attendance.student_absent;

  return (
    <tr
      className="hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      data-testid="insights-row"
      data-teacher={te.id}
    >
      <Td className="text-muted-foreground text-center text-xs font-semibold tabular-nums">{rank ?? "—"}</Td>
      <Td className="max-w-[16rem]">
        <TeacherName teacher={te} />
      </Td>
      <Td className="text-center">
        <ScoreRing score={te.score} size={40} />
      </Td>
      <Td>
        <RateCell
          rate={te.join.on_time_rate}
          part={te.join.on_time}
          whole={te.join.measured}
          segments={joinSegments(te, t)}
          empty={<span className="text-muted-foreground text-xs">{te.has_meeting_url ? t("table.noLessons") : t("table.notMeasured")}</span>}
        />
      </Td>
      <Td className="text-end tabular-nums whitespace-nowrap">
        {te.join.avg_delay_minutes !== null ? dur(te.join.avg_delay_minutes) : <span className="text-muted-foreground">—</span>}
      </Td>
      <Td>
        <RateCell
          rate={te.reports.on_time_rate}
          part={te.reports.on_time}
          whole={te.reports.due}
          segments={reportSegments(te, t)}
          empty={<span className="text-muted-foreground text-xs">{t("table.noReports")}</span>}
        />
      </Td>
      <Td className="text-end tabular-nums whitespace-nowrap">
        {te.reports.avg_delay_minutes !== null ? dur(te.reports.avg_delay_minutes) : <span className="text-muted-foreground">—</span>}
      </Td>
      <Td>
        <RateCell
          rate={te.attendance.teacher_attendance_rate}
          part={showedUp}
          whole={showedUp + te.attendance.teacher_absent}
          segments={attendanceSegments(te, t)}
          empty={<span className="text-muted-foreground text-xs">{t("table.noLessons")}</span>}
        />
        {te.attendance.teacher_absent > 0 && (
          <span className="mt-1 block text-[11px] text-rose-600 dark:text-rose-400">
            {t("table.absences", { n: te.attendance.teacher_absent })}
          </span>
        )}
      </Td>
      <Td className="text-end font-semibold tabular-nums">{te.attendance.lessons}</Td>
    </tr>
  );
}

function TeacherCard({ teacher: te, rank, onOpen }: { teacher: InsightTeacher; rank: number | null; onOpen: () => void }) {
  const t = useTranslations("teacherInsights");
  const dur = useDuration();

  const line = (label: string, rate: number | null, segments: Segment[]) => (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", rateText(rate))}>{fmtRate(rate)}</span>
      </div>
      <SplitBar className="mt-1" segments={segments} />
    </div>
  );

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="bg-card w-full rounded-xl p-3.5 text-start shadow-sm ring-1 ring-foreground/[0.06]"
        data-testid="insights-card"
      >
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground w-5 shrink-0 text-center text-xs font-semibold tabular-nums">{rank ?? "—"}</span>
          <div className="min-w-0 flex-1">
            <TeacherName teacher={te} />
          </div>
          <ScoreRing score={te.score} size={44} />
        </div>
        <div className="mt-3 space-y-2.5">
          {line(t("table.enter"), te.join.on_time_rate, joinSegments(te, t))}
          {line(t("table.reports"), te.reports.on_time_rate, reportSegments(te, t))}
          {line(t("table.attendance"), te.attendance.teacher_attendance_rate, attendanceSegments(te, t))}
        </div>
        <p className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <span>{t("card.avgEnter", { v: dur(te.join.avg_delay_minutes) })}</span>
          <span>{t("card.avgReport", { v: dur(te.reports.avg_delay_minutes) })}</span>
          <span>{t("card.lessons", { n: te.attendance.lessons })}</span>
        </p>
      </button>
    </li>
  );
}
