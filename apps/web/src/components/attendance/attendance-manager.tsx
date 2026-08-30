"use client";

import { SESSION_STATUS } from "@academiq/contracts";
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileSpreadsheet,
  Loader2,
  MessageCircle,
  RotateCcw,
  Search,
  Sparkles,
  UserX,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AttendanceReportModal } from "@/components/attendance/attendance-report-modal";
import { CreateClassModal } from "@/components/attendance/create-class-modal";
import { RescheduleModal } from "@/components/attendance/reschedule-modal";
import { StatusBadge } from "@/components/attendance/status-badge";
import { useAuth } from "@/components/auth-provider";
import {
  addDays,
  addMonths,
  dayLongLabel,
  monthYearLabel,
  startOfMonth,
  startOfWeek,
  weekRangeLabel,
} from "@/components/scheduling/calendar/utils";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import {
  getSessionsByDay,
  listTeachers,
  type DaySession,
  type TeacherRow,
} from "@/lib/api";
import { type ExcelColumn, exportRowsToExcel } from "@/lib/export-excel";
import { cn } from "@/lib/utils";

type Selected = { id: string; name: string | null } | null;

/** How much of the calendar the worklist covers at once. */
type RangeMode = "day" | "week" | "month";

const RANGE_MODES: RangeMode[] = ["day", "week", "month"];

function isRangeMode(v: string | null): v is RangeMode {
  return v === "day" || v === "week" || v === "month";
}

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** The local calendar date (Y-m-d) an instant falls on, in the browser's timezone. */
function localDay(utcIso: string): string {
  const d = new Date(utcIso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * The half-open window the list covers, from the anchor day and the range mode. The instants are
 * built from LOCAL midnight, so "the 3rd" means the viewer's 3rd — exactly as the single-day
 * view always did.
 */
function periodBounds(
  anchor: string,
  mode: RangeMode,
): { firstDay: string; lastDay: string; from: string; to: string } {
  const firstDay =
    mode === "day"
      ? anchor
      : mode === "week"
        ? startOfWeek(anchor)
        : startOfMonth(anchor);
  const endExclusive =
    mode === "day"
      ? addDays(anchor, 1)
      : mode === "week"
        ? addDays(firstDay, 7)
        : addMonths(firstDay, 1);
  return {
    firstDay,
    // The last day INSIDE the window — what a label reads to, and what "does this period
    // contain today?" is measured against.
    lastDay: addDays(endExclusive, -1),
    from: new Date(`${firstDay}T00:00:00`).toISOString(),
    to: new Date(`${endExclusive}T00:00:00`).toISOString(),
  };
}

/** Move the anchor one whole period back (-1) or forward (+1). */
function shiftAnchor(anchor: string, mode: RangeMode, step: -1 | 1): string {
  if (mode === "day") return addDays(anchor, step);
  if (mode === "week") return addDays(anchor, step * 7);
  return addMonths(startOfMonth(anchor), step);
}

// ── Status → subtle row tint ────────────────────────────────────────────────
const STATUS_ROW: Record<string, string> = {
  ATTENDED: "bg-emerald-50/40 dark:bg-emerald-950/10",
  ABSENT_UNEXCUSED: "bg-amber-50/40 dark:bg-amber-950/10",
  RESCHEDULED: "bg-violet-50/40 dark:bg-violet-950/10",
  ABSENT_EXCUSED: "",
  CANCELLED_BY_TEACHER: "bg-rose-50/60 dark:bg-rose-950/15",
  CANCELLED_BY_STUDENT: "bg-rose-50/60 dark:bg-rose-950/15",
  SCHEDULED: "",
};

// ── Status → coloured dot in the Time cell ──────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  SCHEDULED: "bg-blue-500",
  ATTENDED: "bg-emerald-500",
  ABSENT_UNEXCUSED: "bg-amber-500",
  ABSENT_EXCUSED: "bg-slate-400",
  CANCELLED_BY_TEACHER: "bg-rose-500",
  CANCELLED_BY_STUDENT: "bg-rose-500",
  RESCHEDULED: "bg-violet-500",
};

export function AttendanceManager() {
  const t = useTranslations("attendance");
  const tSched = useTranslations("scheduling");
  const tDt = useTranslations("datatable");
  const locale = useLocale();
  const { session: auth, can } = useAuth();
  const isTeacher = auth?.role === "TEACHER";
  // A session can only be moved while it is still SCHEDULED (the server marks the origin
  // RESCHEDULED and mints the successor), so the action only appears on those rows.
  const canReschedule = can("session.reschedule");
  // Owners and teachers alike may log a one-off class the timetable never produced; the API
  // confines a teacher to their own roster.
  const canCreateClass = can("session.create");

  // `date` is the ANCHOR day; `range` says how much of the calendar around it the list covers.
  const [date, setDate] = useState<string>(() => todayStr());
  const [range, setRange] = useState<RangeMode>("day");
  const [teacherId, setTeacherId] = useState("");
  const [status, setStatus] = useState("");
  const [trialOnly, setTrialOnly] = useState(false);
  const [search, setSearch] = useState("");

  const [sessions, setSessions] = useState<DaySession[] | null>(null);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [rescheduling, setRescheduling] = useState<DaySession | null>(null);
  const [creating, setCreating] = useState(false);
  // Optimistic status overrides: updated immediately when attendance is recorded so
  // the row reflects the new status before the next full reload.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // The server returns at most one capped page per window; a busy month can reach it.
  const [truncated, setTruncated] = useState(false);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  // Honour a deep link from the calendar — /attendance?session=<id>&date=<d>&range=<r>&name=<n>
  // — by jumping to that day and opening the session's attendance report straight away.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedDate = params.get("date");
    const linkedRange = params.get("range");
    const sid = params.get("session");
    if (linkedDate) setDate(linkedDate);
    // A link to one session always lands on that session's own day: opening a whole month
    // around it would bury the row the link is about.
    if (!sid && isRangeMode(linkedRange)) setRange(linkedRange);
    if (sid) setSelected({ id: sid, name: params.get("name") });
  }, []);

  // The period on screen IS the URL. Keeping ?date/?range there means a refresh (or a shared
  // link) lands back on the same window instead of silently snapping to today and appearing to
  // lose rows. `session`/`name` are deliberately NOT carried over: they mean "open this report
  // once", so a refresh must not reopen it.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (date !== todayStr()) qs.set("date", date);
    if (range !== "day") qs.set("range", range);
    const query = qs.toString();
    window.history.replaceState(null, "", query ? `/attendance?${query}` : "/attendance");
  }, [date, range]);

  useEffect(() => {
    if (isTeacher) return;
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [isTeacher]);

  // A deep link fires two loads back to back (today on mount, then the linked day), and the
  // filters can outrun each other too. Stamp each request and let only the newest one land, so
  // a slow response for the day you just left can never overwrite the day you are looking at.
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setSessions(null);
    setStatusOverrides({});
    setError(null);
    setTruncated(false);
    try {
      const { from, to } = periodBounds(date, range);
      // Status and trial-only are applied on the CLIENT (below), not sent here. The endpoint
      // returns the whole window either way, and asking the server to pre-filter it made the
      // four counts above the list describe the filtered set rather than the period — so
      // pressing "Attended" left every other tile reading zero. Now the counts always describe
      // the period, the tiles can honestly act as filters, and changing one costs no round trip.
      const res = await getSessionsByDay({
        from,
        to,
        teacher_id: teacherId || undefined,
      });
      if (seq !== reqSeq.current) return; // superseded
      setSessions(res.sessions);
      setTruncated(res.truncated ?? false);
    } catch (err) {
      if (seq !== reqSeq.current) return; // superseded
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [date, range, teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = todayStr();
  const bounds = useMemo(() => periodBounds(date, range), [date, range]);
  const multiDay = range !== "day";
  // Offering "today" is only useful when the window on screen does not already contain it.
  const showsToday = today >= bounds.firstDay && today <= bounds.lastDay;

  /** The period, narrowed by the status tile / select, the trial toggle and the text search. */
  const filteredSessions = useMemo(() => {
    if (!sessions) return null;
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (status && s.status !== status) return false;
      if (
        trialOnly &&
        s.student_status !== "TRIAL" &&
        s.student_status !== "TRIAL_BOOKED"
      ) {
        return false;
      }
      if (
        q &&
        !s.student_name?.toLowerCase().includes(q) &&
        !s.teacher_name?.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [sessions, search, status, trialOnly]);

  const total = sessions?.length ?? 0;
  const attendedCount = sessions?.filter((s) => s.status === "ATTENDED").length ?? 0;
  const pendingCount = sessions?.filter((s) => s.status === "SCHEDULED").length ?? 0;
  const trialCount =
    sessions?.filter(
      (s) => s.student_status === "TRIAL" || s.student_status === "TRIAL_BOOKED",
    ).length ?? 0;

  /** Each cut's share of the whole period — the context a bare count never carries. */
  const dayShare = (value: number) =>
    total > 0 ? Math.round((value / total) * 100) : null;

  // Per-teacher free (trial) lesson breakdown — owner sees all teachers; teacher sees their own row only
  const teacherTrials = useMemo(() => {
    if (!sessions) return null;
    const map = new Map<string, { name: string; count: number }>();
    for (const s of sessions) {
      if (s.student_status === "TRIAL" || s.student_status === "TRIAL_BOOKED") {
        const existing = map.get(s.teacher_id);
        if (existing) {
          existing.count++;
        } else {
          map.set(s.teacher_id, { name: s.teacher_name ?? "—", count: 1 });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [sessions]);

  const periodLabel =
    range === "day"
      ? dayLongLabel(date, locale)
      : range === "week"
        ? weekRangeLabel(bounds.firstDay, locale)
        : monthYearLabel(bounds.firstDay, locale);

  /** A short "Sat 3 Aug" stamp, for rows that no longer all belong to the same day. */
  const dayStampFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    [locale],
  );

  /**
   * Once the window spans more than a day a flat list stops being readable — "9:00" means
   * nothing without its date. Bucket the rows by their local day (the feed is already
   * time-sorted, so each bucket keeps its order) and let the list print a header per day.
   */
  const dayGroups = useMemo(() => {
    if (filteredSessions === null) return null;
    const groups: { day: string; rows: DaySession[] }[] = [];
    for (const s of filteredSessions) {
      const day = localDay(s.scheduled_at_utc);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.rows.push(s);
      else groups.push({ day, rows: [s] });
    }
    return groups;
  }, [filteredSessions]);

  /** Columns in the desktop table — the Teacher column is owner-only. */
  const colCount = 5 + (isTeacher ? 0 : 1);

  const hasActiveFilters = !!(teacherId || status || trialOnly || search);

  function clearFilters() {
    setTeacherId("");
    setStatus("");
    setTrialOnly(false);
    setSearch("");
  }

  function openSession(s: DaySession) {
    setSelected({ id: s.id, name: s.student_name });
  }

  // Export the day's sessions as currently filtered. This view loads a whole day at
  // once (no server pagination), so the visible rows ARE the full matching set.
  async function handleExport() {
    const rows = filteredSessions ?? [];
    if (exporting || rows.length === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      const columns: ExcelColumn<DaySession>[] = [
        {
          header: t("date"),
          value: (s) => dayStampFmt.format(new Date(s.scheduled_at_utc)),
          width: 22,
        },
        {
          header: t("colTime"),
          value: (s) => timeFmt.format(new Date(s.scheduled_at_utc)),
        },
        { header: t("colStudent"), value: (s) => s.student_name, width: 24 },
        ...(!isTeacher
          ? [
              {
                header: t("teacher"),
                value: (s: DaySession) => s.teacher_name,
                width: 24,
              } satisfies ExcelColumn<DaySession>,
            ]
          : []),
        {
          header: t("colDuration"),
          value: (s) => `${s.duration_minutes} ${t("min")}`,
        },
        { header: t("status"), value: (s) => tSched(`status.${s.status}`) },
        {
          header: t("trial"),
          value: (s) =>
            s.student_status === "TRIAL" || s.student_status === "TRIAL_BOOKED"
              ? t("trial")
              : "",
        },
      ];
      await exportRowsToExcel({
        fileName: multiDay
          ? `attendance-${bounds.firstDay}_${bounds.lastDay}`
          : `attendance-${date}`,
        sheetName: t("managerTitle"),
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

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="attendance-hero-lattice"
        icon={ClipboardCheck}
        title={t("managerTitle")}
        subtitle={t("managerSubtitle")}
        actions={
          <>
            {pendingCount > 0 && (
              <span className="border-gold/50 bg-gold text-gold-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm">
                <UserX className="size-3.5" aria-hidden />
                {t("pendingCount")} {pendingCount}
              </span>
            )}
            {!showsToday && (
              <Button
                type="button"
                size="lg"
                data-testid="hero-today"
                onClick={() => setDate(today)}
                className="gap-2 border-white/25 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
              >
                {t("today")}
              </Button>
            )}
            {canCreateClass && (
              <Button
                type="button"
                size="lg"
                data-testid="create-class"
                className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
                onClick={() => setCreating(true)}
              >
                <CalendarPlus className="size-4" aria-hidden />
                {t("createClass")}
              </Button>
            )}
          </>
        }
      />

      {/* ── Period navigator ──────────────────────────────────────────────
          The page used to be nailed to today, which left a past or future lesson reachable only
          through a calendar deep link. Pick any day here, or widen the window to a whole week or
          month; the counts, filters, list and export below all follow it. */}
      <div
        className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm"
        data-testid="period-nav"
      >
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("prevPeriod")}
            title={t("prevPeriod")}
            data-testid="period-prev"
            onClick={() => setDate((d) => shiftAnchor(d, range, -1))}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          </Button>

          {/* A month window is picked as a month; a day or week is picked by its day. */}
          {range === "month" ? (
            <input
              type="month"
              aria-label={t("pickMonth")}
              data-testid="period-month-input"
              value={date.slice(0, 7)}
              onChange={(e) => {
                // An empty value means the field is mid-edit — keep the month we are on.
                if (e.target.value) setDate(`${e.target.value}-01`);
              }}
              className="border-input bg-background focus:border-primary focus:ring-primary/15 h-9 rounded-xl border px-3 text-sm outline-none focus:ring-3"
            />
          ) : (
            <input
              type="date"
              aria-label={t("pickDate")}
              data-testid="period-date-input"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
              className="border-input bg-background focus:border-primary focus:ring-primary/15 h-9 rounded-xl border px-3 text-sm outline-none focus:ring-3"
            />
          )}

          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("nextPeriod")}
            title={t("nextPeriod")}
            data-testid="period-next"
            onClick={() => setDate((d) => shiftAnchor(d, range, 1))}
          >
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-1 h-9"
            data-testid="period-today"
            onClick={() => setDate(today)}
          >
            {t("today")}
          </Button>
        </div>

        {/* Day / week / month */}
        <div
          role="group"
          aria-label={t("rangeLabel")}
          className="bg-muted/60 ms-auto inline-flex items-center gap-0.5 rounded-xl p-0.5"
        >
          {RANGE_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              data-testid={`range-${mode}`}
              aria-pressed={range === mode}
              onClick={() => setRange(mode)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                range === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`range_${mode}`)}
            </button>
          ))}
        </div>

        <p className="text-muted-foreground w-full text-xs" data-testid="period-label">
          {periodLabel}
        </p>
      </div>

      {/* ── The period, cut four ways ────────────────────────────────────
          These were a read-only scoreboard. Each one is now the filter that produces it, so the
          number and the worklist below it always agree. */}
      <div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SegmentTile
            testKey="all"
            icon={CalendarClock}
            label={t("totalCount")}
            value={sessions === null ? null : total}
            share={null}
            tone="emerald"
            selected={!status && !trialOnly}
            onSelect={() => {
              setStatus("");
              setTrialOnly(false);
            }}
          />
          <SegmentTile
            testKey="attended"
            icon={CheckCircle2}
            label={t("attendedCount")}
            value={sessions === null ? null : attendedCount}
            share={dayShare(attendedCount)}
            tone="teal"
            selected={status === "ATTENDED"}
            onSelect={() => {
              setTrialOnly(false);
              setStatus((prev) => (prev === "ATTENDED" ? "" : "ATTENDED"));
            }}
          />
          <SegmentTile
            testKey="pending"
            icon={UserX}
            label={t("pendingCount")}
            value={sessions === null ? null : pendingCount}
            share={dayShare(pendingCount)}
            tone="gold"
            selected={status === "SCHEDULED"}
            onSelect={() => {
              setTrialOnly(false);
              setStatus((prev) => (prev === "SCHEDULED" ? "" : "SCHEDULED"));
            }}
          />
          <SegmentTile
            testKey="trials"
            icon={Sparkles}
            label={t("trialsCount")}
            value={sessions === null ? null : trialCount}
            share={dayShare(trialCount)}
            tone="violet"
            selected={trialOnly}
            onSelect={() => {
              setStatus("");
              setTrialOnly((prev) => !prev);
            }}
          />
        </div>
        <p className="text-muted-foreground/80 mt-2 text-[11px]">
          {t("tilesHint")}
        </p>
      </div>

      {/* ── Free (trial) lessons breakdown ──────────────────────────────── */}
      {teacherTrials !== null && teacherTrials.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/60 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/10">
          <div className="flex items-center gap-2 border-b border-amber-200 px-5 py-3 dark:border-amber-900/40">
            <Sparkles className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {t("freeTrialsTitle")}
            </h2>
            <span className="ms-auto text-xs font-medium text-amber-600 dark:text-amber-400">
              {trialCount} {trialCount === 1 ? t("trialSession") : t("trialSessions")}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 py-3">
            {teacherTrials.map((row) => (
              <div key={row.name} className="flex items-center gap-2">
                <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  {row.name}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  <Sparkles className="size-2.5" />
                  {row.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filter toolbar ────────────────────────────────────────────────── */}
      <div className="bg-card flex flex-wrap items-end gap-3 rounded-2xl border p-4 shadow-sm">
        {/* Search */}
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            type="search"
            aria-label={t("searchPlaceholder")}
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 h-9 w-full rounded-xl border py-2 pe-3 ps-9 text-sm outline-none focus:ring-3"
          />
        </div>

        {/* Teacher filter (Owner only) */}
        {!isTeacher && (
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs font-medium">{t("teacher")}</label>
            <select
              aria-label={t("teacher")}
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="border-input bg-background h-9 rounded-xl border px-3 text-sm outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
            >
              <option value="">{t("allTeachers")}</option>
              {teachers.map((tch) => (
                <option key={tch.id} value={tch.id}>
                  {tch.full_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Status filter */}
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground text-xs font-medium">{t("status")}</label>
          <select
            aria-label={t("status")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border-input bg-background h-9 rounded-xl border px-3 text-sm outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
          >
            <option value="">{t("allStatuses")}</option>
            {SESSION_STATUS.filter(
              (s) => s !== "ABSENT_UNEXCUSED" && s !== "ABSENT_EXCUSED",
            ).map((s) => (
              <option key={s} value={s}>
                {tSched(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Trials-only toggle */}
        <Button
          type="button"
          variant={trialOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setTrialOnly((v) => !v)}
          className={cn(
            "h-9 gap-1.5",
            trialOnly && "border-transparent bg-amber-500 text-white hover:bg-amber-600",
          )}
        >
          <Sparkles className="size-3.5" />
          {t("trialsOnly")}
        </Button>

        {/* Clear all */}
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-9 gap-1"
            onClick={clearFilters}
          >
            <X className="size-3.5" />
            {t("clearFilters")}
          </Button>
        )}
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {truncated && <AlertBanner variant="info" message={t("periodTruncated")} />}

      {/* ── Sessions table ────────────────────────────────────────────────── */}
      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm" data-testid="day-sessions">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">{periodLabel}</h2>
            <p className="text-muted-foreground text-xs">
              {multiDay ? t("periodSubtitle") : t("daySubtitle")}
            </p>
          </div>
          {filteredSessions !== null && filteredSessions.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleExport()}
                disabled={exporting}
                className="gap-1.5"
                data-testid="attendance-export"
              >
                {exporting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <FileSpreadsheet className="size-3.5" aria-hidden />
                )}
                {tDt("export")}
              </Button>
              <span className="text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
                {filteredSessions.length}
              </span>
            </div>
          )}
        </div>
        {exportError && (
          <p
            className="text-destructive border-b px-5 py-2 text-xs font-medium"
            role="alert"
          >
            {exportError}
          </p>
        )}

        {filteredSessions === null ? (
          // Loading state
          <div className="divide-y" data-testid="day-loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4" aria-hidden>
                <div className="bg-muted h-4 w-14 animate-pulse rounded" />
                <div className="bg-muted h-4 flex-1 animate-pulse rounded" />
                <div className="bg-muted h-4 w-28 animate-pulse rounded" />
                <div className="bg-muted h-4 w-16 animate-pulse rounded" />
                <div className="bg-muted h-6 w-20 animate-pulse rounded-full" />
                <div className="bg-muted h-7 w-16 animate-pulse rounded-lg" />
              </div>
            ))}
          </div>
        ) : filteredSessions.length === 0 ? (
          <div
            className="flex flex-col items-center px-5 py-14 text-center"
            data-testid="day-empty"
          >
            <div className="bg-muted mb-3 flex size-12 items-center justify-center rounded-full">
              <CalendarClock className="text-muted-foreground size-5" />
            </div>
            <p className="text-sm font-medium">
              {multiDay ? t("periodNone") : t("dayNone")}
            </p>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 gap-1"
                onClick={clearFilters}
              >
                <X className="size-3.5" />
                {t("clearFilters")}
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* ── Desktop table ─────────────────────────────────────── */}
            <div className="hidden overflow-x-auto sm:block" data-testid="day-list">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                      {t("colTime")}
                    </th>
                    <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                      {t("colStudent")}
                    </th>
                    {!isTeacher && (
                      <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                        {t("teacher")}
                      </th>
                    )}
                    <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                      {t("colDuration")}
                    </th>
                    <th className="text-muted-foreground px-5 py-3 text-start text-xs font-semibold uppercase tracking-wide">
                      {t("status")}
                    </th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(dayGroups ?? []).map((group) => (
                    <Fragment key={group.day}>
                      {/* A day header, only once the window is wider than a single day. */}
                      {multiDay && (
                        <tr
                          className="bg-muted/40"
                          data-testid="day-group"
                          data-day={group.day}
                        >
                          <th
                            scope="colgroup"
                            colSpan={colCount}
                            className="text-muted-foreground px-5 py-2 text-start text-xs font-semibold"
                          >
                            {dayStampFmt.format(new Date(`${group.day}T12:00:00`))}
                            <span className="ms-2 font-normal tabular-nums opacity-70">
                              {group.rows.length}
                            </span>
                          </th>
                        </tr>
                      )}
                      {group.rows.map((s) => {
                        const isTrial =
                          s.student_status === "TRIAL" || s.student_status === "TRIAL_BOOKED";
                        const displayStatus = (statusOverrides[s.id] ?? s.status) as typeof s.status;
                        const isRecorded = displayStatus !== "SCHEDULED";
                        return (
                          <tr
                            key={s.id}
                            data-row={s.id}
                            onClick={() => openSession(s)}
                            className={cn(
                              "cursor-pointer transition-colors hover:bg-muted/30",
                              STATUS_ROW[displayStatus] ?? "",
                            )}
                          >
                            {/* Time + status dot */}
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "size-2 shrink-0 rounded-full transition-colors",
                                    STATUS_DOT[displayStatus] ?? "bg-slate-400",
                                  )}
                                />
                                <span className="font-medium tabular-nums">
                                  {timeFmt.format(new Date(s.scheduled_at_utc))}
                                </span>
                                {/* Checkmark overlay once any outcome is recorded */}
                                {isRecorded && statusOverrides[s.id] && (
                                  <span className="inline-flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                                    <svg className="size-2.5" viewBox="0 0 12 12" fill="none" aria-hidden>
                                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Student + trial badge */}
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{s.student_name ?? "—"}</span>
                                {isTrial && (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                    <Sparkles className="size-2.5" />
                                    {t("trial")}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Teacher (owner only) */}
                            {!isTeacher && (
                              <td className="text-muted-foreground px-5 py-3.5">
                                {s.teacher_name ?? "—"}
                              </td>
                            )}

                            {/* Duration */}
                            <td className="text-muted-foreground px-5 py-3.5">
                              <div className="flex items-center gap-1">
                                <Clock className="size-3.5 shrink-0 opacity-60" />
                                <span className="tabular-nums">
                                  {s.duration_minutes} {t("min")}
                                </span>
                              </div>
                            </td>

                            {/* Status badge */}
                            <td className="px-5 py-3.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <StatusBadge status={displayStatus} />
                                {s.pending_cancel_type && displayStatus === "SCHEDULED" && (
                                  <span
                                    data-testid="awaiting-approval"
                                    title={t("awaitingApprovalHint")}
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                  >
                                    <Clock className="size-2.5" />
                                    {t("awaitingApproval")}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Action */}
                            <td className="px-5 py-3.5 text-end">
                              <div className="flex items-center justify-end gap-2">
                                {/* WhatsApp send — placeholder, disabled until the feature ships. */}
                                {isRecorded && (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    disabled
                                    title={t("whatsappSoon")}
                                    data-testid="row-whatsapp"
                                    className="gap-1.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MessageCircle className="size-3.5" />
                                    {t("sendWhatsapp")}
                                  </Button>
                                )}
                                {canReschedule && displayStatus === "SCHEDULED" && (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    data-testid="row-reschedule"
                                    className="gap-1.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRescheduling(s);
                                    }}
                                  >
                                    <RotateCcw className="size-3.5" />
                                    {tSched("actions.reschedule")}
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  size="xs"
                                  variant={displayStatus === "SCHEDULED" ? "default" : "outline"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openSession(s);
                                  }}
                                >
                                  {displayStatus === "SCHEDULED" ? t("record") : t("open")}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Mobile cards ──────────────────────────────────────── */}
            <ul className="divide-y sm:hidden">
              {(dayGroups ?? []).map((group) => (
                <Fragment key={group.day}>
                  {multiDay && (
                    <li
                      data-testid="day-group"
                      data-day={group.day}
                      className="bg-muted/40 text-muted-foreground px-5 py-2 text-xs font-semibold"
                    >
                      {dayStampFmt.format(new Date(`${group.day}T12:00:00`))}
                      <span className="ms-2 font-normal tabular-nums opacity-70">
                        {group.rows.length}
                      </span>
                    </li>
                  )}
                  {group.rows.map((s) => {
                    const isTrial =
                      s.student_status === "TRIAL" || s.student_status === "TRIAL_BOOKED";
                    const displayStatus = (statusOverrides[s.id] ?? s.status) as typeof s.status;
                    return (
                      <li
                        key={s.id}
                        className={cn(
                          "cursor-pointer px-5 py-4 transition-colors hover:bg-muted/30",
                          STATUS_ROW[displayStatus] ?? "",
                        )}
                        onClick={() => openSession(s)}
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full transition-colors",
                                  STATUS_DOT[displayStatus] ?? "bg-slate-400",
                                )}
                              />
                              <p className="truncate font-semibold">{s.student_name ?? "—"}</p>
                              {isTrial && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                  <Sparkles className="size-2.5" />
                                  {t("trial")}
                                </span>
                              )}
                            </div>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              {s.teacher_name}
                              {" · "}
                              {timeFmt.format(new Date(s.scheduled_at_utc))}
                              {" · "}
                              {s.duration_minutes} {t("min")}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <StatusBadge status={displayStatus} className="shrink-0" />
                            {s.pending_cancel_type && displayStatus === "SCHEDULED" && (
                              <span
                                data-testid="awaiting-approval"
                                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                              >
                                <Clock className="size-2.5" />
                                {t("awaitingApproval")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          {/* WhatsApp send — placeholder, disabled until the feature ships. */}
                          {displayStatus !== "SCHEDULED" && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              disabled
                              title={t("whatsappSoon")}
                              data-testid="row-whatsapp"
                              className="gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MessageCircle className="size-3.5" />
                              {t("sendWhatsapp")}
                            </Button>
                          )}
                          {canReschedule && displayStatus === "SCHEDULED" && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              data-testid="row-reschedule"
                              className="gap-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRescheduling(s);
                              }}
                            >
                              <RotateCcw className="size-3.5" />
                              {tSched("actions.reschedule")}
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="xs"
                            variant={displayStatus === "SCHEDULED" ? "default" : "outline"}
                            onClick={(e) => {
                              e.stopPropagation();
                              openSession(s);
                            }}
                          >
                            {displayStatus === "SCHEDULED" ? t("record") : t("open")}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </Fragment>
              ))}
            </ul>
          </>
        )}

        {/* Table footer: session count */}
        {filteredSessions !== null && filteredSessions.length > 0 && (
          <div className="border-t px-5 py-3">
            <p className="text-muted-foreground text-xs">
              {filteredSessions.length}{" "}
              {filteredSessions.length === 1 ? t("sessionsShownOne") : t("sessionsShown")}
              {sessions && filteredSessions.length !== sessions.length && (
                <>
                  {" · "}
                  {sessions.length} {t("sessionsTotal")}
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Attendance/report popup */}
      <AttendanceReportModal
        sessionId={selected?.id ?? ""}
        studentName={selected?.name}
        open={selected !== null}
        onChange={(sid, newStatus) =>
          setStatusOverrides((prev) => ({ ...prev, [sid]: newStatus }))
        }
        onClose={() => {
          setSelected(null);
          void load();
        }}
      />

      {/* Move a single scheduled class to a new time */}
      <RescheduleModal
        session={rescheduling}
        open={rescheduling !== null}
        onClose={() => setRescheduling(null)}
        onDone={() => {
          setRescheduling(null);
          void load();
        }}
      />

      {/* Log a one-off class the timetable never produced — on ANY date, not just today. It
          opens on the day in view (today whenever the window contains it), and its date/time
          field is free to move anywhere from there. */}
      <CreateClassModal
        day={showsToday ? today : bounds.firstDay}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
      />
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
