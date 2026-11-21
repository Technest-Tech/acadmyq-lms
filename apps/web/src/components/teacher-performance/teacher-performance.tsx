"use client";

import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileWarning,
  Gauge,
  Loader2,
  Search,
  Settings2,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StatusChip } from "@/components/admin/status-chip";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/ui/page-hero";
import {
  ApiError,
  getTeacherPerformance,
  type PerformancePart,
  type PerformanceTeacher,
  type TeacherPerformance as Performance,
} from "@/lib/api";
import { avatarTone, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { PerformanceSettingsModal } from "./performance-settings";
import {
  currentMonth,
  fmtScore,
  INPUT_CLASS,
  Meter,
  monthLabel,
  PART_ICON,
  PARTS,
  ScoreRing,
  scoreText,
  shiftMonth,
  TIER_CHIP,
  tierOf,
  useDuration,
} from "./performance-ui";
import { TeacherPerformanceDetail, type DetailView } from "./teacher-performance-detail";

/**
 * Teacher performance: every teacher's evaluation for one month.
 *
 * Four parts make the total — the supervisor's lesson visits, the reports written after lessons
 * and trials, entering lessons on time, and conduct. Two of them the supervisor records here
 * (a lesson visit, a note); the other two the system already keeps. Every teacher is a card with
 * the same four lines, and a card opens the lessons, visits and notes behind its number.
 */

type Filter = "all" | "notVisited" | "attention";
type SortKey = "total" | "name" | PerformancePart;

/** A total under this needs a conversation — the same line the "fair" tier is drawn at. */
const ATTENTION_BELOW = 75;

const MATCH: Record<Exclude<Filter, "all">, (te: PerformanceTeacher) => boolean> = {
  // Taught this month and nobody has sat in a lesson yet.
  notVisited: (te) => te.is_active && te.lessons.total > 0 && te.quality.visits === 0,
  attention: (te) => te.total !== null && te.total < ATTENTION_BELOW,
};

function sortValue(te: PerformanceTeacher, key: SortKey): number | string | null {
  if (key === "name") return te.name;
  if (key === "total") return te.total;
  return te[key].score;
}

export function TeacherPerformance() {
  const t = useTranslations("teacherPerformance");
  const locale = useLocale();

  const thisMonth = currentMonth();
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("total");
  const [open, setOpen] = useState<{ teacher: PerformanceTeacher; view: DetailView } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Months change faster than the server answers — only the latest request may land.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getTeacherPerformance(month);
      if (ticket === latest.current) setData(next);
    } catch (e) {
      if (ticket === latest.current) setError(e instanceof ApiError ? e.message : t("loadError"));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const teachers = useMemo(() => data?.teachers ?? [], [data]);
  const counts = useMemo(
    () => ({ notVisited: teachers.filter(MATCH.notVisited).length, attention: teachers.filter(MATCH.attention).length }),
    [teachers],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    let list = filter === "all" ? [...teachers] : teachers.filter(MATCH[filter]);
    if (q) list = list.filter((te) => te.name.toLocaleLowerCase().includes(q));
    return list.sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      // Nothing to measure sorts last.
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string") return va.localeCompare(vb as string);
      return (vb as number) - va || a.name.localeCompare(b.name);
    });
  }, [teachers, query, filter, sort]);

  const first = loading && !data;
  const summary = data?.summary;
  const canManage = data?.can.manage ?? false;

  return (
    <div className="space-y-6" data-testid="teacher-performance">
      <PageHero
        icon={Gauge}
        title={t("title")}
        subtitle={t("subtitle")}
        latticeId="teacher-performance-hero"
        actions={
          <span className="flex items-center gap-2">
            {loading && <Loader2 className="size-5 animate-spin text-white/80" aria-hidden />}
            {data?.can.settings && (
              <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)} data-testid="performance-settings-button">
                <Settings2 aria-hidden />
                {t("settings.open")}
              </Button>
            )}
          </span>
        }
      />

      {/* ── The month ───────────────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm" data-testid="performance-toolbar">
        <div className="flex items-center gap-1" role="group" aria-label={t("month.label")}>
          <Button variant="outline" size="icon" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={t("month.previous")} data-testid="month-previous">
            <ChevronRight className="ltr:rotate-180" aria-hidden />
          </Button>
          <span className="min-w-32 px-2 text-center text-sm font-bold" data-testid="month-label">
            {monthLabel(month, locale)}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            // A month that has not started has nothing to evaluate.
            disabled={month >= thisMonth}
            aria-label={t("month.next")}
            data-testid="month-next"
          >
            <ChevronLeft className="ltr:rotate-180" aria-hidden />
          </Button>
          {month !== thisMonth && (
            <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth)} data-testid="month-current">
              {t("month.current")}
            </Button>
          )}
        </div>
        <label className="relative min-w-full flex-1 sm:min-w-0">
          <span className="sr-only">{t("search")}</span>
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            className={cn(INPUT_CLASS, "ps-9")}
            data-testid="performance-search"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground whitespace-nowrap">{t("sortBy")}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={cn(INPUT_CLASS, "w-auto py-1.5")} data-testid="performance-sort">
            <option value="total">{t("sort.total")}</option>
            <option value="name">{t("sort.name")}</option>
            {PARTS.map((p) => (
              <option key={p} value={p}>
                {t(`part.${p}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* ── The academy this month ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-card flex min-w-0 items-center gap-4 rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]" data-testid="tile-average">
          {first ? (
            <div className="bg-muted size-[64px] shrink-0 animate-pulse rounded-full" aria-hidden />
          ) : (
            <ScoreRing score={summary?.average ?? null} size={64} stroke={6} />
          )}
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium">{t("tile.average")}</p>
            {!first && tierOf(summary?.average ?? null) && (
              <StatusChip tone={TIER_CHIP[tierOf(summary?.average ?? null)!]} className="mt-1">
                {t(`tier.${tierOf(summary?.average ?? null)!}`)}
              </StatusChip>
            )}
            <p className="text-muted-foreground mt-1 text-xs">{first ? " " : t("tile.averageSub", { n: summary?.teachers ?? 0 })}</p>
          </div>
        </div>
        <Tile
          icon={ClipboardCheck}
          label={t("tile.visits")}
          value={summary ? t("tile.visitsValue", { n: summary.visited, due: summary.visits_due }) : ""}
          sub={summary ? t("tile.visitsSub", { n: summary.visits }) : ""}
          bar={summary && summary.visits_due > 0 ? (summary.visited / summary.visits_due) * 100 : null}
          loading={first}
          testId="tile-visits"
        />
        <Tile
          icon={FileWarning}
          label={t("tile.reports")}
          value={summary ? String(summary.reports_missing) : ""}
          valueClass={summary && summary.reports_missing > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
          sub={summary ? (summary.reports_missing > 0 ? t("tile.reportsSub") : t("tile.reportsNone")) : ""}
          loading={first}
          testId="tile-reports"
        />
        <Tile
          icon={ShieldAlert}
          label={t("tile.notes")}
          value={summary ? String(summary.notes) : ""}
          sub={summary ? (summary.unclassified > 0 ? t("tile.notesUnclassified", { n: summary.unclassified }) : t("tile.notesSub")) : ""}
          subClass={summary && summary.unclassified > 0 ? "text-amber-700 dark:text-amber-400" : undefined}
          loading={first}
          testId="tile-notes"
        />
      </div>

      {/* ── Every teacher ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="no-scrollbar flex gap-1 overflow-x-auto" role="group" aria-label={t("filter.label")}>
          {(["all", "notVisited", "attention"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              data-testid={`performance-filter-${f}`}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === f ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`filter.${f}`)}
              <span className="ms-1.5 tabular-nums opacity-70">{f === "all" ? teachers.length : counts[f]}</span>
            </button>
          ))}
        </div>

        {first ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-card h-72 animate-pulse rounded-2xl border" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-12 text-center text-sm" data-testid="performance-empty">
            {teachers.length === 0 ? t("empty") : t("noMatch")}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="performance-cards">
            {rows.map((te) => (
              <TeacherCard
                key={te.id}
                teacher={te}
                canManage={canManage}
                onOpen={(view) => setOpen({ teacher: te, view })}
              />
            ))}
          </ul>
        )}
      </section>

      {data && <HowItWorks data={data} />}

      {open && (
        <TeacherPerformanceDetail
          // A different teacher, month or starting form is a different dialog.
          key={`${open.teacher.id}-${month}-${open.view.kind}`}
          teacher={open.teacher}
          month={month}
          initialView={open.view}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
        />
      )}
      {settingsOpen && data && (
        <PerformanceSettingsModal
          settings={data.settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Tile({
  icon: Icon,
  label,
  value,
  valueClass,
  sub,
  subClass,
  bar,
  loading,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  valueClass?: string;
  sub: ReactNode;
  subClass?: string;
  /** A share, 0–100, drawn as a bar under the figure. */
  bar?: number | null;
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
        <p className={cn("mt-1.5 text-2xl font-bold tracking-tight tabular-nums", valueClass)}>{value}</p>
      )}
      <p className={cn("mt-0.5 text-xs", subClass ?? "text-muted-foreground")}>{loading ? " " : sub}</p>
      {bar !== undefined && bar !== null && !loading && (
        <div className="mt-auto pt-3">
          <Meter score={bar} />
        </div>
      )}
    </div>
  );
}

/**
 * One teacher's month as a card: who, the total, the same four lines on every card so a page of
 * them reads as a grid, and what the supervisor can do next.
 */
function TeacherCard({
  teacher: te,
  canManage,
  onOpen,
}: {
  teacher: PerformanceTeacher;
  canManage: boolean;
  onOpen: (view: DetailView) => void;
}) {
  const t = useTranslations("teacherPerformance");
  const tier = tierOf(te.total);

  const conductParts = [
    te.conduct.absences > 0 ? t("card.absences", { n: te.conduct.absences }) : null,
    te.conduct.apologies > 0 ? t("card.apologies", { n: te.conduct.apologies }) : null,
    te.conduct.violations > 0 ? t("card.violations", { n: te.conduct.violations }) : null,
  ].filter(Boolean);

  const line: Record<PerformancePart, string> = {
    quality:
      te.quality.visits > 0
        ? t("card.visits", { n: te.quality.visits, target: te.quality.target })
        : te.lessons.total > 0
          ? t("card.notVisited")
          : t("card.nothing"),
    reports:
      te.reports.due > 0 ? t("card.reports", { n: te.reports.on_time, due: te.reports.due }) : t("card.nothing"),
    entry:
      te.entry.measured > 0
        ? t("card.entry", { n: te.entry.on_time, measured: te.entry.measured })
        : te.has_meeting_url
          ? t("card.nothing")
          : t("card.noLink"),
    conduct:
      conductParts.length > 0
        ? conductParts.join(" · ")
        : te.conduct.unclassified > 0
          ? t("card.unclassified", { n: te.conduct.unclassified })
          : te.conduct.score !== null
            ? t("card.noNotes")
            : t("card.nothing"),
  };

  return (
    <li className="bg-card flex flex-col rounded-2xl border shadow-sm" data-testid="performance-card" data-teacher={te.id}>
      {/* Who, and where the month stands. */}
      <div className="flex items-center gap-3 px-4 pt-4">
        <span
          className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm", avatarTone(te.name))}
          aria-hidden
        >
          {initials(te.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{te.name}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {te.lessons.total > 0 ? t("lessonsCount", { n: te.lessons.total }) : t("card.noLessons")}
          </p>
        </div>
        <span className="shrink-0 self-start">
          {!te.is_active ? (
            <StatusChip tone="neutral">{t("card.inactive")}</StatusChip>
          ) : tier ? (
            <StatusChip tone={TIER_CHIP[tier]}>{t(`tier.${tier}`)}</StatusChip>
          ) : null}
        </span>
      </div>

      {/* The month's total. */}
      <div className="bg-muted/40 mx-4 mt-3.5 rounded-xl px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground text-xs font-medium">{t("card.total")}</span>
          {te.total !== null ? (
            <span className={cn("text-xl font-bold tabular-nums", scoreText(te.total))} data-testid="card-total">
              {t("card.outOf", { score: fmtScore(te.total) })}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs font-medium" data-testid="card-total">
              {t("card.noTotal")}
            </span>
          )}
        </div>
        <Meter score={te.total} className="mt-2.5" />
      </div>

      {/* The same four lines on every card. */}
      <dl className="divide-border/60 divide-y px-4 py-1.5 text-xs">
        {PARTS.map((part) => {
          const Icon = PART_ICON[part];
          return (
            <div key={part} className="py-2" data-testid={`card-${part}`}>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground flex shrink-0 items-center gap-1.5">
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {t(`part.${part}`)}
                </dt>
                <dd className="min-w-0 truncate text-end font-medium" title={line[part]}>
                  {line[part]}
                </dd>
              </div>
              <Meter score={te[part].score} className="mt-1.5 h-1" />
            </div>
          );
        })}
      </dl>

      {/* What to do next. */}
      <div className="bg-muted/25 mt-auto flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t px-4 py-2.5">
        <span className="flex flex-wrap items-center gap-1.5">
          {canManage && (
            <>
              <Button size="sm" onClick={() => onOpen({ kind: "visit" })} data-testid="card-add-visit">
                <ClipboardCheck aria-hidden />
                {t("actions.visit")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOpen({ kind: "note" })} data-testid="card-add-note">
                {t("actions.note")}
              </Button>
            </>
          )}
        </span>
        <Button size="sm" variant="ghost" onClick={() => onOpen({ kind: "main" })} data-testid="card-details">
          {t("actions.details")}
        </Button>
      </div>
    </li>
  );
}

/** The rules the numbers follow, in the academy's own figures — so anyone can explain a total. */
function HowItWorks({ data }: { data: Performance }) {
  const t = useTranslations("teacherPerformance");
  const dur = useDuration();
  const s = data.settings;

  return (
    <details className="bg-card group rounded-xl p-4 text-sm shadow-sm ring-1 ring-foreground/[0.06]" data-testid="performance-how">
      <summary className="cursor-pointer select-none font-semibold">{t("how.title")}</summary>
      <ul className="text-muted-foreground mt-3 list-disc space-y-1.5 ps-5 text-xs leading-relaxed">
        <li>{t("how.total", { quality: s.weights.quality, reports: s.weights.reports, entry: s.weights.entry, conduct: s.weights.conduct })}</li>
        <li>{t("how.quality", { target: s.visits_target })}</li>
        <li>{t("how.reports", { within: dur(s.report_minutes) })}</li>
        <li>{t("how.entry", { late: s.late_minutes })}</li>
        <li>{t("how.conduct", { absence: s.points.ABSENCE, apology: s.points.APOLOGY, violation: s.points.VIOLATION })}</li>
        <li>{t("how.missing")}</li>
      </ul>
    </details>
  );
}
