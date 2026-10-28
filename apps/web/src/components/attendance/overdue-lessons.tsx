"use client";

import {
  AlarmClock,
  CalendarX2,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  TriangleAlert,
  Users,
  UserX,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { FollowControl, type FollowInfo } from "@/components/attendance/follow-control";
import { Button } from "@/components/ui/button";
import { SegmentTile } from "@/components/ui/segment-tile";
import { getOverdueSessions, type OverdueSession } from "@/lib/api";
import { type ExcelColumn, exportRowsToExcel } from "@/lib/export-excel";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface OverdueState {
  sessions: OverdueSession[];
  count: number;
  truncated: boolean;
  graceHours: number;
  loading: boolean;
  reload: () => void;
}

/**
 * The overdue worklist behind the Held-up tab and the attendance hero's badge. One fetch, shared
 * by whoever needs the number, so the badge and the list can never disagree.
 *
 * `refreshKey` is any value the caller bumps when a lesson may have been marked (closing the
 * attendance popup, saving a reschedule) — the list re-reads and a lesson that just got its
 * outcome drops out of it.
 *
 * `mine` narrows it to the lessons of students the caller added (the attendance page's "My
 * lessons" tab); `null` means the page does not know yet which tab it is on, so nothing is read
 * until it does — rather than showing everyone's backlog and then snapping to the caller's.
 */
export function useOverdueLessons(refreshKey: unknown = 0, mine: boolean | null = false): OverdueState {
  const [sessions, setSessions] = useState<OverdueSession[]>([]);
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [graceHours, setGraceHours] = useState(4);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (mine === null) return;
    let alive = true;
    setLoading(true);
    getOverdueSessions({ mine })
      .then((r) => {
        if (!alive) return;
        setSessions(r.sessions);
        setCount(r.count);
        setTruncated(r.truncated);
        setGraceHours(r.grace_hours);
      })
      // The backlog is an extra signal on top of the page, never the page itself: if it cannot
      // load, it stays silent rather than pushing an error banner over the day's worklist.
      .catch(() => {
        if (!alive) return;
        setSessions([]);
        setCount(0);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, tick, mine]);

  return { sessions, count, truncated, graceHours, loading, reload };
}

/** Who a held-up lesson is waiting on: nobody marked it, or a request sits with the owner. */
export type OverdueHolder = "" | "marking" | "approval";

/** "Late by at least N days", measured from when the lesson ENDED. 0 = any age. */
const AGE_DAYS = [1, 3, 7, 30] as const;

/** The age the "over a week" tile stands for — the line past which a lesson is a real problem. */
const WEEK = 7;

const DAY_MS = 86_400_000;

export interface OverdueFilters {
  search: string;
  teacherId: string;
  holder: OverdueHolder;
  /** Minimum days since the lesson ended; 0 = any. */
  age: number;
  trialOnly: boolean;
  /** How the list is bucketed: by the lesson's day, or by the teacher who owes it. */
  group: "day" | "teacher";
}

export const EMPTY_OVERDUE_FILTERS: OverdueFilters = {
  search: "",
  teacherId: "",
  holder: "",
  age: 0,
  trialOnly: false,
  group: "day",
};

function isTrial(s: OverdueSession): boolean {
  return s.student_status === "TRIAL" || s.student_status === "TRIAL_BOOKED";
}

/** The instant the lesson ended — the moment the grace window starts counting from. */
function endedAt(s: OverdueSession): number {
  return new Date(s.scheduled_at_utc).getTime() + s.duration_minutes * 60_000;
}

/** The local calendar date (Y-m-d) an instant falls on, in the browser's timezone. */
function localDay(utcIso: string): string {
  const d = new Date(utcIso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

const selectClass =
  "border-input bg-background h-9 w-full rounded-xl border px-3 text-sm outline-none focus:border-primary focus:ring-3 focus:ring-primary/15 sm:w-auto";

/**
 * الحصص المعلقة — the lessons that ended hours ago and STILL carry no outcome, as a worklist of
 * its own on the attendance page.
 *
 * It used to be a red strip above the period navigator showing five rows; with a real backlog
 * that strip was the busiest thing on the page and the hardest to work. Here it gets the same
 * tools the period list has — tiles that are filters, search, teacher, age, trials — plus the cut
 * that matters most for chasing: who the lesson is waiting on, and, grouped by teacher, who owes
 * the most.
 *
 * Every count describes the backlog under the teacher filter only, never the search box or the
 * toggles, so a tile keeps meaning "this many" while the list below it narrows.
 */
export function OverdueLessonsBoard({
  state,
  filters,
  onFiltersChange,
  onOpen,
  onReschedule,
  isTeacher,
  canFollow,
  onError,
  onSeeAll,
}: {
  state: OverdueState;
  /** Owned by the page, so switching to the period tab and back keeps the chase where it was. */
  filters: OverdueFilters;
  onFiltersChange: (next: OverdueFilters) => void;
  /** Open the attendance/report popup for one lesson. */
  onOpen: (s: OverdueSession) => void;
  /** Move the lesson to a new time; absent when the login may not reschedule. */
  onReschedule?: (s: OverdueSession) => void;
  /** A teacher sees their OWN backlog, so the copy addresses them and the teacher cuts go. */
  isTeacher: boolean;
  canFollow: boolean;
  onError: (message: string) => void;
  /** Offered on an empty "My lessons" backlog: the rest of the academy may still owe some. */
  onSeeAll?: () => void;
}) {
  const t = useTranslations("attendance");
  const tb = useTranslations("attendance.overdueBoard");
  const tSched = useTranslations("scheduling");
  const tDt = useTranslations("datatable");
  const locale = useLocale();
  const [followOverrides, setFollowOverrides] = useState<Record<string, FollowInfo>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const set = (patch: Partial<OverdueFilters>) => onFiltersChange({ ...filters, ...patch });

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }),
    [locale],
  );

  // Ages are read against the moment the backlog was fetched, so a row never changes bucket
  // between two renders of the same data.
  const now = useMemo(() => Date.now(), [state.sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const lateDays = useCallback((s: OverdueSession) => (now - endedAt(s)) / DAY_MS, [now]);

  /** Teachers who owe at least one lesson, the heaviest first — the select's options. */
  const teacherCounts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const s of state.sessions) {
      const row = map.get(s.teacher_id);
      if (row) row.count++;
      else map.set(s.teacher_id, { id: s.teacher_id, name: s.teacher_name ?? "—", count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [state.sessions]);

  /** The backlog the tiles count: everything, or one teacher's share of it. */
  const base = useMemo(
    () =>
      filters.teacherId
        ? state.sessions.filter((s) => s.teacher_id === filters.teacherId)
        : state.sessions,
    [state.sessions, filters.teacherId],
  );

  const approvalCount = base.filter((s) => s.pending_approval).length;
  const markingCount = base.length - approvalCount;
  const weekCount = base.filter((s) => lateDays(s) >= WEEK).length;
  // The server's count is the true backlog even when it capped the rows; under a teacher filter
  // only the rows can say how many are that teacher's.
  const totalCount = filters.teacherId ? base.length : state.count;
  const share = (n: number) => (base.length > 0 ? Math.round((n / base.length) * 100) : null);

  const rows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return base.filter((s) => {
      if (filters.holder === "approval" && !s.pending_approval) return false;
      if (filters.holder === "marking" && s.pending_approval) return false;
      if (filters.age > 0 && lateDays(s) < filters.age) return false;
      if (filters.trialOnly && !isTrial(s)) return false;
      if (
        q &&
        !s.student_name?.toLowerCase().includes(q) &&
        !s.teacher_name?.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [base, filters, lateDays]);

  /**
   * By day: oldest first, as the feed already is. By teacher: whoever owes the most first, each
   * teacher's lessons still oldest first — the order a supervisor phones people in.
   */
  const groups = useMemo(() => {
    const byTeacher = filters.group === "teacher" && !isTeacher;
    const out: { key: string; label: string; rows: OverdueSession[] }[] = [];
    const index = new Map<string, number>();
    for (const s of rows) {
      const key = byTeacher ? s.teacher_id : localDay(s.scheduled_at_utc);
      let i = index.get(key);
      if (i === undefined) {
        i = out.length;
        index.set(key, i);
        out.push({
          key,
          label: byTeacher
            ? (s.teacher_name ?? "—")
            : dayFmt.format(new Date(`${key}T12:00:00`)),
          rows: [],
        });
      }
      out[i]!.rows.push(s);
    }
    if (byTeacher) out.sort((a, b) => b.rows.length - a.rows.length);
    return out;
  }, [rows, filters.group, isTeacher, dayFmt]);

  const byTeacher = filters.group === "teacher" && !isTeacher;
  const hasActiveFilters = !!(
    filters.search ||
    filters.teacherId ||
    filters.holder ||
    filters.age ||
    filters.trialOnly
  );

  function clearFilters() {
    onFiltersChange({ ...EMPTY_OVERDUE_FILTERS, group: filters.group });
  }

  const followInfo = (s: OverdueSession): FollowInfo | null =>
    followOverrides[s.id] ??
    (s.followed_at ? { followed_at: s.followed_at, followed_by_name: s.followed_by_name ?? null } : null);

  /** Day grouping already says the date, so the row only needs the time. */
  const lessonStamp = (s: OverdueSession) => {
    const at = new Date(s.scheduled_at_utc);
    return byTeacher ? `${dayFmt.format(at)} · ${timeFmt.format(at)}` : timeFmt.format(at);
  };

  async function handleExport() {
    if (exporting || rows.length === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      const columns: ExcelColumn<OverdueSession>[] = [
        { header: t("date"), value: (s) => dayFmt.format(new Date(s.scheduled_at_utc)), width: 22 },
        { header: t("colTime"), value: (s) => timeFmt.format(new Date(s.scheduled_at_utc)) },
        { header: t("colStudent"), value: (s) => s.student_name, width: 24 },
        ...(!isTeacher
          ? [
              {
                header: t("teacher"),
                value: (s: OverdueSession) => s.teacher_name,
                width: 24,
              } satisfies ExcelColumn<OverdueSession>,
            ]
          : []),
        { header: t("colDuration"), value: (s) => `${s.duration_minutes} ${t("min")}` },
        { header: tb("colLateDays"), value: (s) => Math.floor(lateDays(s)) },
        {
          header: tb("colHolder"),
          value: (s) => tb(s.pending_approval ? "holderApproval" : "holderMarking"),
          width: 18,
        },
        { header: t("trial"), value: (s) => (isTrial(s) ? t("trial") : "") },
      ];
      await exportRowsToExcel({
        fileName: `held-up-lessons-${localDay(new Date(now).toISOString())}`,
        sheetName: t("overdueTitle"),
        columns,
        rows,
        rightToLeft: locale === "ar",
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : tDt("exportError"));
    } finally {
      setExporting(false);
    }
  }

  /** The chip that says what the lesson is stuck on — the owner's approval, or nobody's mark. */
  function holderChip(s: OverdueSession) {
    // A pending cancellation/free request means the teacher already acted and the OWNER owes an
    // approval — chasing the teacher for it would be chasing the wrong person.
    if (s.pending_approval) {
      return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <Clock className="size-2.5" aria-hidden />
          {t("awaitingApproval")}
        </span>
      );
    }
    return (
      <span
        data-testid="overdue-late-by"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-600/10 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300"
      >
        <TriangleAlert className="size-2.5" aria-hidden />
        {t("overdueLateBy", {
          when: formatRelativeTime(new Date(endedAt(s)).toISOString(), locale),
        })}
      </span>
    );
  }

  function actions(s: OverdueSession) {
    return (
      <>
        <FollowControl
          sessionId={s.id}
          followed={followInfo(s)}
          canFollow={canFollow}
          onFollowed={(info) => setFollowOverrides((m) => ({ ...m, [s.id]: info }))}
          onError={onError}
        />
        {onReschedule && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="overdue-reschedule"
            className="gap-1.5"
            onClick={(e) => {
              e.stopPropagation();
              onReschedule(s);
            }}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {tSched("actions.reschedule")}
          </Button>
        )}
        <Button
          type="button"
          size="xs"
          data-testid="overdue-record"
          className="shrink-0 border-transparent bg-rose-600 text-white hover:bg-rose-700"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(s);
          }}
        >
          {t("record")}
        </Button>
      </>
    );
  }

  // First load only: a reload after marking a lesson keeps the list on screen instead of
  // blanking the worklist the user is halfway through.
  const firstLoad = state.loading && state.sessions.length === 0 && state.count === 0;

  // A clean slate. Said once, plainly, on the tab the user chose to open.
  if (!firstLoad && state.count === 0) {
    return (
      <div
        data-testid="overdue-clear"
        className="bg-card flex flex-col items-center rounded-2xl border px-5 py-14 text-center shadow-sm"
      >
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20">
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </div>
        <p className="text-sm font-semibold">{tb("emptyTitle")}</p>
        <p className="text-muted-foreground mt-1 max-w-md text-xs">
          {tb("emptyBody", { hours: state.graceHours })}
        </p>
        {onSeeAll && (
          <Button type="button" variant="ghost" size="sm" className="mt-3 gap-1" onClick={onSeeAll}>
            <Users className="size-3.5" aria-hidden />
            {t("scope.seeAll")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="overdue-board">
      <p className="text-muted-foreground text-xs">
        {isTeacher
          ? t("overdueSubtitleTeacher", { hours: state.graceHours })
          : tb("subtitle", { hours: state.graceHours })}
      </p>

      {/* ── The backlog, cut four ways ─────────────────────────────────────
          The same contract as the period tiles: each count is the filter that produces it. */}
      <div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SegmentTile
            testKey="overdue-all"
            icon={AlarmClock}
            label={tb("tileAll")}
            hint={tb("tileAllHint")}
            value={firstLoad ? null : totalCount}
            share={null}
            tone="rose"
            selected={!filters.holder && !filters.age}
            onSelect={() => set({ holder: "", age: 0 })}
          />
          <SegmentTile
            testKey="overdue-marking"
            icon={UserX}
            label={tb("tileMarking")}
            hint={tb("tileMarkingHint")}
            value={firstLoad ? null : markingCount}
            share={share(markingCount)}
            tone="slate"
            selected={filters.holder === "marking"}
            onSelect={() =>
              set({ age: 0, holder: filters.holder === "marking" ? "" : "marking" })
            }
          />
          <SegmentTile
            testKey="overdue-approval"
            icon={Clock}
            label={tb("tileApproval")}
            hint={tb("tileApprovalHint")}
            value={firstLoad ? null : approvalCount}
            share={share(approvalCount)}
            tone="gold"
            selected={filters.holder === "approval"}
            onSelect={() =>
              set({ age: 0, holder: filters.holder === "approval" ? "" : "approval" })
            }
          />
          <SegmentTile
            testKey="overdue-week"
            icon={CalendarX2}
            label={tb("tileWeek")}
            hint={tb("tileWeekHint")}
            value={firstLoad ? null : weekCount}
            share={share(weekCount)}
            tone="violet"
            selected={filters.age === WEEK && !filters.holder}
            onSelect={() => set({ holder: "", age: filters.age === WEEK ? 0 : WEEK })}
          />
        </div>
        <p className="text-muted-foreground/80 mt-2 text-[11px]">{t("tilesHint")}</p>
      </div>

      {/* ── Filter toolbar ─────────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-end gap-3 rounded-2xl border p-3 shadow-sm sm:p-4">
        <div className="relative min-w-full flex-1 sm:min-w-0">
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            type="search"
            aria-label={t("searchPlaceholder")}
            placeholder={t("searchPlaceholder")}
            data-testid="overdue-search"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            className="border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 h-9 w-full rounded-xl border py-2 pe-3 ps-9 text-sm outline-none focus:ring-3"
          />
        </div>

        {/* Teacher — only the ones who owe something, each with how much. */}
        {!isTeacher && (
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
            <label className="text-muted-foreground text-xs font-medium">{t("teacher")}</label>
            <select
              aria-label={t("teacher")}
              data-testid="overdue-teacher"
              value={filters.teacherId}
              onChange={(e) => set({ teacherId: e.target.value })}
              className={selectClass}
            >
              <option value="">{t("allTeachers")}</option>
              {teacherCounts.map((tc) => (
                <option key={tc.id} value={tc.id}>
                  {tc.name} ({tc.count})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
          <label className="text-muted-foreground text-xs font-medium">{tb("holder")}</label>
          <select
            aria-label={tb("holder")}
            data-testid="overdue-holder"
            value={filters.holder}
            onChange={(e) => set({ holder: e.target.value as OverdueHolder })}
            className={selectClass}
          >
            <option value="">{tb("holderAny")}</option>
            <option value="marking">{tb("tileMarking")}</option>
            <option value="approval">{tb("tileApproval")}</option>
          </select>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
          <label className="text-muted-foreground text-xs font-medium">{tb("age")}</label>
          <select
            aria-label={tb("age")}
            data-testid="overdue-age"
            value={filters.age}
            onChange={(e) => set({ age: Number(e.target.value) })}
            className={selectClass}
          >
            <option value={0}>{tb("ageAny")}</option>
            {AGE_DAYS.map((d) => (
              <option key={d} value={d}>
                {tb(`age${d}`)}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="button"
          variant={filters.trialOnly ? "default" : "outline"}
          size="sm"
          data-testid="overdue-trials"
          aria-pressed={filters.trialOnly}
          onClick={() => set({ trialOnly: !filters.trialOnly })}
          className={cn(
            "h-9 gap-1.5",
            filters.trialOnly && "border-transparent bg-amber-500 text-white hover:bg-amber-600",
          )}
        >
          <Sparkles className="size-3.5" aria-hidden />
          {t("trialsOnly")}
        </Button>

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="overdue-clear-filters"
            className="text-muted-foreground h-9 gap-1"
            onClick={clearFilters}
          >
            <X className="size-3.5" aria-hidden />
            {t("clearFilters")}
          </Button>
        )}
      </div>

      {state.truncated && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          {tb("truncated", { shown: state.sessions.length, total: state.count })}
        </p>
      )}

      {/* ── The worklist ───────────────────────────────────────────────── */}
      <div
        className="bg-card overflow-hidden rounded-2xl border border-rose-200 shadow-sm dark:border-rose-900/50"
        data-testid="overdue-list"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200 bg-rose-50/60 px-4 py-3 sm:px-5 dark:border-rose-900/50 dark:bg-rose-950/20">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-900 dark:text-rose-100">
            <AlarmClock className="size-4 text-rose-600 dark:text-rose-400" aria-hidden />
            {t("overdueTitle")}
            <span
              data-testid="overdue-count"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold tabular-nums text-white"
            >
              {rows.length.toLocaleString()}
            </span>
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            {/* Day or teacher — the second is how a backlog gets chased, one phone call each. */}
            {!isTeacher && (
              <div
                role="group"
                aria-label={tb("groupBy")}
                className="bg-background/70 inline-flex items-center gap-0.5 rounded-xl border p-0.5"
              >
                {(["day", "teacher"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    data-testid={`overdue-group-${g}`}
                    aria-pressed={filters.group === g}
                    onClick={() => set({ group: g })}
                    className={cn(
                      "rounded-lg px-3 py-1 text-xs font-semibold transition-colors",
                      filters.group === g
                        ? "bg-rose-600 text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tb(g === "day" ? "groupDay" : "groupTeacher")}
                  </button>
                ))}
              </div>
            )}
            {rows.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleExport()}
                disabled={exporting}
                className="gap-1.5"
                data-testid="overdue-export"
              >
                {exporting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <FileSpreadsheet className="size-3.5" aria-hidden />
                )}
                {tDt("export")}
              </Button>
            )}
          </div>
        </div>
        {exportError && (
          <p className="text-destructive border-b px-5 py-2 text-xs font-medium" role="alert">
            {exportError}
          </p>
        )}

        {firstLoad ? (
          <div className="divide-y" data-testid="overdue-loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4" aria-hidden>
                <div className="bg-muted h-4 w-20 animate-pulse rounded" />
                <div className="bg-muted h-4 flex-1 animate-pulse rounded" />
                <div className="bg-muted h-6 w-24 animate-pulse rounded-full" />
                <div className="bg-muted h-7 w-16 animate-pulse rounded-lg" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center" data-testid="overdue-no-match">
            <p className="text-sm font-medium">{tb("noMatch")}</p>
            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="sm" className="mt-3 gap-1" onClick={clearFilters}>
                <X className="size-3.5" aria-hidden />
                {t("clearFilters")}
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* ── Desktop table ─────────────────────────────────────── */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                      {byTeacher ? tb("colLesson") : t("colTime")}
                    </th>
                    <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                      {t("colStudent")}
                    </th>
                    {!isTeacher && !byTeacher && (
                      <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                        {t("teacher")}
                      </th>
                    )}
                    <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                      {t("colDuration")}
                    </th>
                    <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                      {tb("colHolder")}
                    </th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {groups.map((g) => (
                    <Fragment key={g.key}>
                      <tr className="bg-muted/40" data-testid="overdue-group" data-group={g.key}>
                        <th
                          scope="colgroup"
                          colSpan={!isTeacher && !byTeacher ? 6 : 5}
                          className="text-muted-foreground px-5 py-2 text-start text-xs font-semibold"
                        >
                          {g.label}
                          <span className="ms-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600/10 px-1.5 text-[10px] font-bold tabular-nums text-rose-700 dark:text-rose-300">
                            {g.rows.length}
                          </span>
                        </th>
                      </tr>
                      {g.rows.map((s) => (
                        <tr
                          key={s.id}
                          data-testid="overdue-row"
                          onClick={() => onOpen(s)}
                          className="hover:bg-muted/30 cursor-pointer transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="size-2 shrink-0 rounded-full bg-rose-500" aria-hidden />
                              <span className="font-medium tabular-nums">{lessonStamp(s)}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{s.student_name ?? "—"}</span>
                              {isTrial(s) && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                  <Sparkles className="size-2.5" aria-hidden />
                                  {t("trial")}
                                </span>
                              )}
                            </div>
                          </td>
                          {!isTeacher && !byTeacher && (
                            <td className="text-muted-foreground px-5 py-3.5">{s.teacher_name ?? "—"}</td>
                          )}
                          <td className="text-muted-foreground px-5 py-3.5 tabular-nums">
                            {s.duration_minutes} {t("min")}
                          </td>
                          <td className="px-5 py-3.5">{holderChip(s)}</td>
                          <td className="px-5 py-3.5 text-end">
                            <div className="flex items-center justify-end gap-2">{actions(s)}</div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Mobile cards ──────────────────────────────────────── */}
            <ul className="divide-y sm:hidden">
              {groups.map((g) => (
                <Fragment key={g.key}>
                  <li
                    data-testid="overdue-group"
                    data-group={g.key}
                    className="bg-muted/40 text-muted-foreground px-4 py-2 text-xs font-semibold"
                  >
                    {g.label}
                    <span className="ms-2 font-normal tabular-nums opacity-70">{g.rows.length}</span>
                  </li>
                  {g.rows.map((s) => (
                    <li
                      key={s.id}
                      data-testid="overdue-card"
                      className="hover:bg-muted/30 cursor-pointer px-4 py-3.5 transition-colors"
                      onClick={() => onOpen(s)}
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-semibold">{s.student_name ?? "—"}</p>
                            {isTrial(s) && (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                <Sparkles className="size-2.5" aria-hidden />
                                {t("trial")}
                              </span>
                            )}
                          </div>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {!isTeacher && !byTeacher && s.teacher_name ? `${s.teacher_name} · ` : ""}
                            {lessonStamp(s)}
                            {" · "}
                            {s.duration_minutes} {t("min")}
                          </p>
                        </div>
                        {holderChip(s)}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">{actions(s)}</div>
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>

            <div className="border-t px-5 py-3">
              <p className="text-muted-foreground text-xs">
                {rows.length} {rows.length === 1 ? t("sessionsShownOne") : t("sessionsShown")}
                {rows.length !== totalCount && (
                  <>
                    {" · "}
                    {totalCount} {t("sessionsTotal")}
                  </>
                )}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
