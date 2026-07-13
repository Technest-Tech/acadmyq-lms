"use client";

import { SESSION_STATUS } from "@academiq/contracts";
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { AttendanceReportModal } from "@/components/attendance/attendance-report-modal";
import { CreateClassModal } from "@/components/attendance/create-class-modal";
import { RescheduleModal } from "@/components/attendance/reschedule-modal";
import { StatusBadge } from "@/components/attendance/status-badge";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getSessionsByDay,
  listTeachers,
  type DaySession,
  type TeacherRow,
} from "@/lib/api";
import { type ExcelColumn, exportRowsToExcel } from "@/lib/export-excel";
import { cn } from "@/lib/utils";

type Selected = { id: string; name: string | null } | null;

function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function dayBounds(dateStr: string): { from: string; to: string } {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
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

  const [date, setDate] = useState<string>(() => todayStr());
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

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  // Honour a deep link from the calendar — /attendance?session=<id>&date=<d>&name=<n> — by
  // jumping to that day and opening the session's attendance report straight away.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedDate = params.get("date");
    const sid = params.get("session");
    if (linkedDate) setDate(linkedDate);
    if (sid) setSelected({ id: sid, name: params.get("name") });
  }, []);

  // The day on screen IS the URL. Keeping ?date there means a refresh (or a shared link) lands
  // back on the same day instead of silently snapping to today and appearing to lose rows —
  // which is invisible now that the day navigator is gone. `session`/`name` are deliberately
  // NOT carried over: they mean "open this report once", so a refresh must not reopen it.
  useEffect(() => {
    const url = date === todayStr() ? "/attendance" : `/attendance?date=${date}`;
    window.history.replaceState(null, "", url);
  }, [date]);

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
    try {
      const { from, to } = dayBounds(date);
      const res = await getSessionsByDay({
        from,
        to,
        teacher_id: teacherId || undefined,
        status: status || undefined,
        trial_only: trialOnly || undefined,
      });
      if (seq !== reqSeq.current) return; // superseded
      setSessions(res.sessions);
    } catch (err) {
      if (seq !== reqSeq.current) return; // superseded
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [date, teacherId, status, trialOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  // With the day navigator gone the page sits on today, except when the calendar deep-links a
  // past/future session — hence the "today" escape hatch in the header still has a job to do.
  const today = todayStr();
  const isToday = date === today;

  // Client-side text search over student / teacher name
  const filteredSessions = useMemo(() => {
    if (!sessions) return null;
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(
      (s) =>
        s.student_name?.toLowerCase().includes(q) ||
        s.teacher_name?.toLowerCase().includes(q),
    );
  }, [sessions, search]);

  const total = sessions?.length ?? 0;
  const attendedCount = sessions?.filter((s) => s.status === "ATTENDED").length ?? 0;
  const pendingCount = sessions?.filter((s) => s.status === "SCHEDULED").length ?? 0;
  const trialCount =
    sessions?.filter(
      (s) => s.student_status === "TRIAL" || s.student_status === "TRIAL_BOOKED",
    ).length ?? 0;

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

  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));

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
        { header: t("date"), value: () => dayLabel, width: 22 },
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
        fileName: `attendance-${date}`,
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
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("managerTitle")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("managerSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isToday && (
            <Button type="button" variant="outline" size="sm" onClick={() => setDate(today)}>
              {t("today")}
            </Button>
          )}
          {canCreateClass && (
            <Button
              type="button"
              size="sm"
              data-testid="create-class"
              className="gap-1.5"
              onClick={() => setCreating(true)}
            >
              <CalendarPlus className="size-4" />
              {t("createClass")}
            </Button>
          )}
        </div>
      </div>

      {/* ── 4-stat strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={CalendarClock} label={t("totalCount")} value={total} color="blue" loading={sessions === null} />
        <StatCard icon={CheckCircle2} label={t("attendedCount")} value={attendedCount} color="green" loading={sessions === null} />
        <StatCard icon={UserX} label={t("pendingCount")} value={pendingCount} color="amber" loading={sessions === null} />
        <StatCard icon={Sparkles} label={t("trialsCount")} value={trialCount} color="violet" loading={sessions === null} />
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

      {/* ── Sessions table ────────────────────────────────────────────────── */}
      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm" data-testid="day-sessions">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">{dayLabel}</h2>
            <p className="text-muted-foreground text-xs">{t("daySubtitle")}</p>
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
            <p className="text-sm font-medium">{t("dayNone")}</p>
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
                  {filteredSessions.map((s) => {
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
                </tbody>
              </table>
            </div>

            {/* ── Mobile cards ──────────────────────────────────────── */}
            <ul className="divide-y sm:hidden">
              {filteredSessions.map((s) => {
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

      {/* Log a one-off class the timetable never produced */}
      <CreateClassModal
        day={date}
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

const STAT_COLORS = {
  blue: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    icon: "text-blue-500 dark:text-blue-400",
    value: "text-blue-700 dark:text-blue-300",
  },
  green: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    icon: "text-emerald-500 dark:text-emerald-400",
    value: "text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    icon: "text-amber-500 dark:text-amber-400",
    value: "text-amber-700 dark:text-amber-300",
  },
  violet: {
    bg: "bg-violet-50 dark:bg-violet-950/30",
    icon: "text-violet-500 dark:text-violet-400",
    value: "text-violet-700 dark:text-violet-300",
  },
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  loading,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: keyof typeof STAT_COLORS;
  loading: boolean;
}) {
  const c = STAT_COLORS[color];
  return (
    <div className="bg-card flex items-center gap-3 rounded-2xl border p-4 shadow-sm sm:gap-4 sm:p-5">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11",
          c.bg,
        )}
      >
        <Icon className={cn("size-4 sm:size-5", c.icon)} aria-hidden />
      </div>
      <div>
        {loading ? (
          <div className="bg-muted mb-1 h-6 w-10 animate-pulse rounded" />
        ) : (
          <div className={cn("text-xl font-bold tabular-nums sm:text-2xl", c.value)}>
            {value.toLocaleString()}
          </div>
        )}
        <div className="text-muted-foreground text-xs font-medium">{label}</div>
      </div>
    </div>
  );
}
