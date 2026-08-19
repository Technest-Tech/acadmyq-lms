"use client";

import { CalendarDays, GraduationCap, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SessionStatus } from "@academiq/contracts";
import { useAuth } from "@/components/auth-provider";
import { AgendaView } from "@/components/scheduling/calendar/agenda-view";
import { CalendarFilters } from "@/components/scheduling/calendar/calendar-filters";
import { MonthView } from "@/components/scheduling/calendar/month-view";
import { TimetablesSummary } from "@/components/scheduling/calendar/summary";
import { TimeGridView } from "@/components/scheduling/calendar/time-grid-view";
import { CalendarToolbar } from "@/components/scheduling/calendar/toolbar";
import { TimetablesView } from "@/components/scheduling/calendar/timetables-view";
import {
  addDays,
  addMonths,
  type CalendarView,
  dayLongLabel,
  minutesIntoDay,
  monthGridDays,
  monthYearLabel,
  startOfMonth,
  startOfWeek,
  todayInTz,
  weekRangeLabel,
} from "@/components/scheduling/calendar/utils";
import { AddTimetableModal } from "@/components/scheduling/add-timetable-modal";
import { QuickCreateModal } from "@/components/scheduling/quick-create-modal";
import { ScheduleSection } from "@/components/scheduling/schedule-editor";
import { SessionActions } from "@/components/scheduling/session-actions";
import { TimetableLogModal } from "@/components/scheduling/timetable-log-modal";
import { AlertBanner } from "@/components/ui/alert";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { buttonVariants } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  type AvailabilityWindow,
  type CalendarSession,
  type CalendarTrial,
  getCalendar,
  listStudents,
  listTeachers,
  listTimetables,
  rescheduleSession,
  type StudentRow,
  type TeacherRow,
  type TimetableSummary,
} from "@/lib/api";

type PageTab = "calendar" | "timetables";

/**
 * The premium calendar (§5.5, AC-5.9). Two top-level tabs:
 *   • Calendar — one feed, three ways to read it (Month, Week, Day) with a navigation toolbar,
 *     an at-a-glance summary strip, and a session actions modal. The feed carries BOOKED TRIALS
 *     alongside the lessons: a trial is a real hour of a real teacher (booked from the CRM when
 *     a lead reaches the TRIAL stage), so leaving it off this screen would invite double-booking
 *     it. Trials are painted, not managed — no drag-to-reschedule, no attendance; clicking one
 *     shows what it is and points at the Trials page.
 *   • Student timetables — the academy's full roster of recurring weekly schedules
 *     (period-independent), with update / lesson-log / new-timetable affordances.
 * Every session renders at its time in the VIEWER's timezone (the stored UTC never changes); a
 * Teacher sees only their own sessions and only the Calendar tab (the server enforces both); an
 * Owner can pick any teacher.
 */
export function WeeklyCalendar({
  timeZone,
}: {
  /** Viewer timezone; defaults to the browser's resolved zone. */
  timeZone?: string;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const { can, session } = useAuth();
  const tz =
    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const isTeacher = session?.role === "TEACHER";

  const canPickTeacher = can("teacher.read");
  const canPickStudent = can("student.read");
  const canManage = can("schedule.manage");
  // Reschedule/cancel/attendance are academy-admin actions. A teacher can still open an event,
  // but only to view its basic details — the popup renders read-only for them regardless of the
  // raw permissions they carry (a teacher holds session.reschedule, but not on this surface).
  const canAct = can("session.reschedule") || can("session.cancel");
  const canOpenDetails = canAct || isTeacher;
  // Drag-to-reschedule and click-to-create are owner-side affordances; teachers stay read-only
  // on this surface even though they carry session.reschedule elsewhere.
  const canDrag = !isTeacher && can("session.reschedule");
  const canQuickCreate = !isTeacher && canManage;

  // The recurring-timetable roster lives in its own tab; the calendar feed itself can be read
  // four ways. List is the readable one on a phone, so everyone — teachers included — gets it.
  const allowedViews: CalendarView[] = ["month", "week", "day", "list"];

  const today = todayInTz(tz);
  // Top-level tab. Teachers never get the timetables tab, so they're pinned to "calendar".
  const [pageTab, setPageTab] = useState<PageTab>("calendar");
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(today);
  const [teacherId, setTeacherId] = useState("");
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [studentId, setStudentId] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [trials, setTrials] = useState<CalendarTrial[]>([]);
  const [selected, setSelected] = useState<CalendarSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Non-blocking info banner (e.g. conflict/availability warnings after a drag-reschedule).
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Client-side filters over the fetched feed: free-text + a status whitelist (empty = all).
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<Set<SessionStatus>>(new Set());
  // Quick-create target: the empty slot the owner clicked (viewer-tz day + "HH:MM").
  const [quickCreate, setQuickCreate] = useState<{
    date: string;
    time: string;
  } | null>(null);
  // Timetable list affordances (List view): update a student's recurring schedule,
  // read the full lesson log, or add a brand-new timetable.
  const [editStudent, setEditStudent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [logStudent, setLogStudent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // The Timetables tab is the academy's full roster — period-independent, so it has its own
  // fetch (the recurring schedules, not the month's generated sessions).
  const [timetables, setTimetables] = useState<TimetableSummary[]>([]);
  const [ttLoading, setTtLoading] = useState(false);

  // The fetch window + the title both follow the active view.
  const { from, to, title } = useMemo(() => {
    switch (view) {
      case "month":
      // The List view is the month's agenda — the same window as Month, read as a feed. Both
      // fetch the whole 6-week grid so a session in a leading/trailing week is never missing.
      case "list": {
        const grid = monthGridDays(anchor);
        return {
          from: grid[0]!,
          to: grid[41]!,
          title: monthYearLabel(startOfMonth(anchor), locale),
        };
      }
      case "day":
        // Pad ±1 day so sessions that fall on `anchor` in the viewer's timezone but
        // outside the UTC calendar day (timezone offset spillover) are still returned.
        // bucketByDay groups by local date, so only anchor's sessions are rendered.
        return {
          from: addDays(anchor, -1),
          to: addDays(anchor, 1),
          title: dayLongLabel(anchor, locale),
        };
      default: {
        const ws = startOfWeek(anchor);
        return {
          from: ws,
          to: addDays(ws, 6),
          title: weekRangeLabel(ws, locale),
        };
      }
    }
  }, [view, anchor, locale]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCalendar({
        from,
        to,
        teacherId: teacherId || undefined,
        studentId: studentId || undefined,
      });
      setSessions(res.sessions);
      setTrials(res.trials ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSessions([]);
      setTrials([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, teacherId, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadTimetables = useCallback(async () => {
    setTtLoading(true);
    try {
      const res = await listTimetables();
      // Keep the List view's teacher/student filters meaningful (the roster is academy-wide).
      const filtered = res.timetables.filter(
        (tt) =>
          (!teacherId || tt.teacher_id === teacherId) &&
          (!studentId || tt.student_id === studentId),
      );
      setTimetables(filtered);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setTimetables([]);
    } finally {
      setTtLoading(false);
    }
  }, [teacherId, studentId]);

  useEffect(() => {
    if (pageTab !== "timetables") return;
    void loadTimetables();
  }, [pageTab, loadTimetables]);

  useEffect(() => {
    // The roster powers both the teacher filter and the quick-create teacher picker.
    if (!canPickTeacher && !canManage) return;
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [canPickTeacher, canManage]);

  useEffect(() => {
    // The roster powers both the student filter and the "new timetable" picker.
    if (!canPickStudent && !canManage) return;
    void listStudents({ pageSize: 100, filter: { status: "active" } })
      .then((r) => setStudents(r.rows))
      .catch(() => setStudents([]));
  }, [canPickStudent, canManage]);

  const teacherOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: "", label: t("calendar.allTeachers") },
      ...teachers.map((tch) => ({ value: tch.id, label: tch.full_name })),
    ],
    [teachers, t],
  );

  const studentOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: "", label: t("calendar.allStudents") },
      ...students.map((s) => ({
        value: s.id,
        label: s.full_name,
        sublabel: s.teacher_name ?? undefined,
      })),
    ],
    [students, t],
  );

  // Navigation advances by the active view's period; "next" keeps the next-week test id.
  const step = useCallback(
    (dir: 1 | -1) => {
      setSelected(null);
      setAnchor((a) => {
        if (view === "day") return addDays(a, dir);
        // List shares Month's window, so it has to share Month's stride too.
        if (view === "month" || view === "list") return addMonths(a, dir);
        return addDays(a, dir * 7);
      });
    },
    [view],
  );

  const days = useMemo(() => {
    if (view === "day") return [anchor];
    const ws = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [view, anchor]);

  const openDay = useCallback((day: string) => {
    setAnchor(day);
    setView("day");
  }, []);

  /**
   * A booked trial, shaped so the views can draw it next to the lessons. It borrows the SCHEDULED
   * status because that is exactly what it is — an hour that is going to happen — and carries the
   * trial itself so everything downstream can tell the two apart (`s.trial !== undefined`).
   */
  const trialEvents = useMemo<CalendarSession[]>(
    () =>
      trials.map((tr) => ({
        id: tr.id,
        student_id: tr.student_id ?? "",
        teacher_id: tr.teacher_id,
        schedule_id: null,
        scheduled_at_utc: tr.scheduled_at_utc,
        duration_minutes: tr.duration_minutes,
        status: "SCHEDULED" as SessionStatus,
        status_reason: null,
        original_session_id: null,
        student_name: tr.display_name,
        teacher_name: tr.teacher_name,
        trial: tr,
      })),
    [trials],
  );

  const events = useMemo(
    () => [...sessions, ...trialEvents],
    [sessions, trialEvents],
  );

  // Apply the search + status filters to the fetched feed (everything downstream — views and
  // the summary strip — reads this so the numbers always match what's on screen).
  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((s) => {
      if (statuses.size > 0 && !statuses.has(s.status)) return false;
      if (!q) return true;
      return (
        (s.student_name ?? "").toLowerCase().includes(q) ||
        (s.teacher_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [events, query, statuses]);

  const toggleStatus = useCallback((s: SessionStatus) => {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  // Drag-drop landing: move a session to a new day + start-minute (viewer tz → wall clock).
  const rescheduleTo = useCallback(
    async (s: CalendarSession, day: string, startMin: number) => {
      // Trials are painted here, not managed — moving one is the Trials page's job (its id is a
      // trial id, which the session endpoint would rightly refuse).
      if (s.trial) return;
      const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
      const mm = String(startMin % 60).padStart(2, "0");
      try {
        const res = await rescheduleSession(s.id, {
          local_datetime: `${day} ${hh}:${mm}`,
          timezone: tz,
        });
        setNotice(
          res.warnings?.length
            ? res.warnings.map((w) => w.message).join(" · ")
            : null,
        );
        void load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      }
    },
    [tz, load],
  );

  // Click an empty grid slot → open quick-create pre-filled with that day + time.
  const openQuickCreate = useCallback((day: string, startMin: number) => {
    const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
    const mm = String(startMin % 60).padStart(2, "0");
    setQuickCreate({ date: day, time: `${hh}:${mm}` });
  }, []);

  // The toolbar's New-session button has no slot to read a time from, so it defaults to the
  // next half-hour boundary on the day the user is looking at. Clicking the grid (or a month
  // cell) still wins — that carries a real intent about when.
  const openQuickCreateDefault = useCallback(
    (day?: string) => {
      const target = day ?? (view === "day" ? anchor : today);
      // On any day other than today, "the next half hour" is meaningless — open at 09:00.
      const nowMin = minutesIntoDay(new Date().toISOString(), tz);
      const startMin =
        target === today
          ? Math.min(Math.ceil(nowMin / 30) * 30, 23 * 60)
          : 9 * 60;
      openQuickCreate(target, startMin);
    },
    [view, anchor, today, tz, openQuickCreate],
  );

  // The selected teacher's weekly availability, painted behind the Week/Day grid so an owner
  // can see at a glance whether they're dropping a lesson into a window the teacher works.
  // With "All teachers" picked there is no single set of windows to draw, so none are.
  const availability = useMemo(
    () => {
      // Same json-column caveat as the roster: a cached row can still carry the raw string.
      const raw = teachers.find((tch) => tch.id === teacherId)?.availability;
      if (Array.isArray(raw)) return raw;
      if (typeof raw === "string") {
        try {
          const parsed: unknown = JSON.parse(raw);
          return Array.isArray(parsed) ? (parsed as AvailabilityWindow[]) : [];
        } catch {
          return [];
        }
      }
      return [];
    },
    [teachers, teacherId],
  );

  return (
    <div className="space-y-5" data-testid="weekly-calendar">
      <PageHero
        latticeId="calendar-hero-lattice"
        icon={CalendarDays}
        title={t("calendar.title")}
        subtitle={t("calendar.subtitle")}
        actions={
          !loading ? (
            <HeroPill>
              <CalendarDays className="size-3.5" aria-hidden />
              {t("calendar.sessionsInView", { count: visibleSessions.length })}
            </HeroPill>
          ) : undefined
        }
      />

      {/* ── Top-level tabs (teachers get the Calendar tab only) ──────────── */}
      {!isTeacher && (
        <div
          role="tablist"
          className="bg-card flex gap-1 rounded-2xl border p-1.5 shadow-sm"
        >
          <PageTabButton
            tabKey="calendar"
            icon={CalendarDays}
            label={t("tabs.calendar")}
            active={pageTab === "calendar"}
            onClick={() => {
              setSelected(null);
              setPageTab("calendar");
            }}
          />
          <PageTabButton
            tabKey="timetables"
            icon={Users}
            label={t("tabs.timetables")}
            active={pageTab === "timetables"}
            onClick={() => {
              setSelected(null);
              setPageTab("timetables");
            }}
            count={timetables.length}
          />
        </div>
      )}

      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      {notice && (
        <AlertBanner
          variant="info"
          message={notice}
          onDismiss={() => setNotice(null)}
        />
      )}

      {pageTab === "calendar" ? (
        <>
          <CalendarToolbar
            t={t}
            title={title}
            view={view}
            onView={(v) => {
              setSelected(null);
              setView(v);
            }}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onToday={() => {
              setSelected(null);
              setAnchor(today);
            }}
            canPickTeacher={canPickTeacher}
            teacherOptions={teacherOptions}
            teacherId={teacherId}
            onTeacher={(id) => {
              setTeacherId(id);
              setSelected(null);
            }}
            canPickStudent={canPickStudent}
            studentOptions={studentOptions}
            studentId={studentId}
            onStudent={(id) => {
              setStudentId(id);
              setSelected(null);
            }}
            allowedViews={allowedViews}
            onCreate={
              canQuickCreate ? () => openQuickCreateDefault() : undefined
            }
          />

          <CalendarFilters
            t={t}
            query={query}
            onQuery={setQuery}
            statuses={statuses}
            onToggleStatus={toggleStatus}
            onClear={() => setStatuses(new Set())}
            shown={visibleSessions.length}
            total={events.length}
          />

          {/* The first load has nothing to show yet, so it gets a skeleton rather than an empty
              grid that would flash "no sessions" before the feed lands. A refetch (navigating a
              week, switching teacher) keeps the current grid and just dims it. */}
          {loading && events.length === 0 ? (
            <CalendarSkeleton view={view} />
          ) : (
            <div
              className={cn(
                "transition-opacity",
                loading && "pointer-events-none opacity-50",
              )}
              aria-busy={loading}
            >
              {view === "month" && (
                <MonthView
                  anchor={anchor}
                  sessions={visibleSessions}
                  tz={tz}
                  today={today}
                  onSelect={(s) => canOpenDetails && setSelected(s)}
                  onDrillDay={openDay}
                  onCreateOn={
                    canQuickCreate
                      ? (day) => openQuickCreateDefault(day)
                      : undefined
                  }
                />
              )}
              {(view === "week" || view === "day") && (
                <TimeGridView
                  days={days}
                  sessions={visibleSessions}
                  tz={tz}
                  today={today}
                  availability={availability}
                  onSelect={(s) => canOpenDetails && setSelected(s)}
                  onReschedule={
                    canDrag
                      ? (s, day, min) => void rescheduleTo(s, day, min)
                      : undefined
                  }
                  onCreateAt={canQuickCreate ? openQuickCreate : undefined}
                  canDrag={canDrag}
                  canCreate={canQuickCreate}
                />
              )}
              {view === "list" && (
                <AgendaView
                  sessions={visibleSessions}
                  tz={tz}
                  today={today}
                  onSelect={(s) => canOpenDetails && setSelected(s)}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Roster filters — period-independent, so no date nav / view switcher. */}
          {(canPickTeacher || canPickStudent) && (
            <div className="flex flex-wrap items-center gap-2">
              {canPickTeacher && (
                <Combobox
                  data-testid="calendar-teacher"
                  className="w-40 sm:w-44"
                  options={teacherOptions}
                  value={teacherId}
                  onChange={setTeacherId}
                  placeholder={t("calendar.allTeachers")}
                  searchPlaceholder={t("calendar.searchTeacher")}
                />
              )}
              {canPickStudent && (
                <Combobox
                  data-testid="calendar-student"
                  className="w-40 sm:w-44"
                  options={studentOptions}
                  value={studentId}
                  onChange={setStudentId}
                  placeholder={t("calendar.allStudents")}
                  searchPlaceholder={t("calendar.searchStudent")}
                />
              )}
            </div>
          )}

          <TimetablesSummary timetables={timetables} />

          <TimetablesView
            timetables={timetables}
            loading={ttLoading}
            canManage={canManage}
            onUpdate={(id, name) => setEditStudent({ id, name })}
            onLog={(id, name) => setLogStudent({ id, name })}
            onAddNew={() => setAddOpen(true)}
          />
        </>
      )}

      {/* Session actions modal — or, for a trial, the read-only card that says what it is. */}
      {selected && canOpenDetails && (
        <Modal
          open
          onClose={() => setSelected(null)}
          // The date, time and duration are the detail card's job now — repeating them in the
          // modal's subtitle just said the same thing twice.
          title={
            selected.trial
              ? t("trialEvent.title")
              : t("actions.title", {
                  name: selected.student_name ?? t("calendar.unnamedStudent"),
                })
          }
          size="md"
        >
          {selected.trial ? (
            <TrialEventCard
              trial={selected.trial}
              tz={tz}
              locale={locale}
              t={t}
              onClose={() => setSelected(null)}
            />
          ) : (
            <SessionActions
              session={selected}
              timeZone={tz}
              hideHeader
              readOnly={isTeacher}
              onClose={() => setSelected(null)}
              onDone={() => {
                setSelected(null);
                void load();
              }}
              onError={setError}
            />
          )}
        </Modal>
      )}

      {/* Update a student's recurring timetable (List view — owner only) */}
      {!isTeacher && editStudent && canManage && (
        <Modal
          open
          onClose={() => setEditStudent(null)}
          title={t("timetables.updateTitle")}
          description={editStudent.name}
          size="lg"
        >
          <ScheduleSection
            studentId={editStudent.id}
            canManage={canManage}
            onError={setError}
            onChanged={() => {
              void load();
              void loadTimetables();
            }}
          />
        </Modal>
      )}

      {/* Full lesson log for a student's timetable (List view — owner only) */}
      {!isTeacher && logStudent && (
        <TimetableLogModal
          studentId={logStudent.id}
          studentName={logStudent.name}
          tz={tz}
          canAct={canAct}
          onClose={() => setLogStudent(null)}
          onSelectSession={(s) => {
            setLogStudent(null);
            setSelected(s);
          }}
        />
      )}

      {/* Quick-create a one-off session from a clicked empty slot (Calendar tab — owner only) */}
      {quickCreate && canQuickCreate && (
        <QuickCreateModal
          students={students}
          teachers={teachers}
          defaultTeacherId={teacherId || undefined}
          initialDate={quickCreate.date}
          initialTime={quickCreate.time}
          timeZone={tz}
          onClose={() => setQuickCreate(null)}
          onCreated={(warnings) => {
            setQuickCreate(null);
            setNotice(warnings.length ? warnings.join(" · ") : null);
            void load();
          }}
        />
      )}

      {/* Add a brand-new student timetable (List view — owner only) */}
      {!isTeacher && addOpen && canManage && (
        <AddTimetableModal
          students={students}
          defaultTimezone={tz}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            void load();
            void loadTimetables();
          }}
        />
      )}
    </div>
  );
}

// ── Trial event card ──────────────────────────────────────────────────────────

/**
 * What a booked trial is, read-only: who it is for, who is taking it, when, and where to go to
 * act on it. Nothing here writes — a trial's outcome, cancellation and conversion belong to the
 * Trials page, and the person it was booked for belongs to the CRM.
 */
function TrialEventCard({
  trial,
  tz,
  locale,
  t,
  onClose,
}: {
  trial: CalendarTrial;
  tz: string;
  locale: string;
  t: ReturnType<typeof useTranslations<"scheduling">>;
  onClose: () => void;
}) {
  const start = new Date(trial.scheduled_at_utc);
  const end = new Date(start.getTime() + trial.duration_minutes * 60_000);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: tz }).format(d);
  const dayLabel = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone: tz,
  }).format(start);

  return (
    <div className="space-y-4" data-testid="calendar-trial-card">
      <div className="flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 px-4 py-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {trial.display_name ?? t("calendar.unnamedStudent")}
          </p>
          <p className="text-muted-foreground text-xs">{t("trialEvent.intro")}</p>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {t("trialEvent.when")}
          </dt>
          <dd className="text-sm font-medium">
            {dayLabel}
            <span className="text-muted-foreground ms-1 tabular-nums" dir="ltr">
              {fmt(start)} – {fmt(end)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {t("trialEvent.teacher")}
          </dt>
          <dd className="flex items-center gap-1.5 text-sm font-medium">
            <GraduationCap className="text-muted-foreground size-3.5" aria-hidden />
            {trial.teacher_name ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {trial.lead_id !== null && (
          <Link
            href="/crm"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          >
            {t("trialEvent.openCrm")}
          </Link>
        )}
        <Link
          href="/trials"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
        >
          {t("trialEvent.openTrials")}
        </Link>
        <button
          type="button"
          onClick={onClose}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          {t("trialEvent.close")}
        </button>
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

/**
 * The first-load placeholder. It mirrors the shape of the view it's standing in for — a 6×7 grid
 * of cells for Month, stacked rows for List, a column-and-gutter frame for Week/Day — so the
 * layout doesn't jump when the real feed lands.
 */
function CalendarSkeleton({ view }: { view: CalendarView }) {
  const bar = "bg-muted animate-pulse rounded-md";

  if (view === "list") {
    return (
      <div
        className="bg-card divide-y overflow-hidden rounded-2xl border shadow-sm"
        data-testid="calendar-skeleton"
        aria-busy
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <div className={cn(bar, "h-10 w-1 rounded-full")} />
            <div className={cn(bar, "h-9 w-14")} />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className={cn(bar, "h-3.5 w-32")} />
              <div className={cn(bar, "h-3 w-20")} />
            </div>
            <div className={cn(bar, "h-6 w-20 rounded-full")} />
          </div>
        ))}
      </div>
    );
  }

  if (view === "month") {
    return (
      <div
        className="bg-card overflow-hidden rounded-2xl border shadow-sm"
        data-testid="calendar-skeleton"
        aria-busy
      >
        <div className="grid grid-cols-7 [&>*]:border-t [&>*]:border-s [&>*:nth-child(7n+1)]:border-s-0">
          {Array.from({ length: 42 }, (_, i) => (
            <div key={i} className="min-h-28 space-y-1.5 p-1.5 sm:min-h-32">
              <div className={cn(bar, "size-6 rounded-full")} />
              {i % 3 === 0 && <div className={cn(bar, "h-4 w-full")} />}
              {i % 4 === 0 && <div className={cn(bar, "h-4 w-4/5")} />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const cols = view === "day" ? 1 : 7;
  return (
    <div
      className="bg-card overflow-hidden rounded-2xl border shadow-sm"
      data-testid="calendar-skeleton"
      aria-busy
    >
      <div
        className="grid border-b"
        style={{ gridTemplateColumns: `4rem repeat(${cols}, minmax(0, 1fr))` }}
      >
        <div className="border-e" />
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1 border-s py-2.5">
            <div className={cn(bar, "h-3 w-8")} />
            <div className={cn(bar, "size-8 rounded-full")} />
          </div>
        ))}
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: `4rem repeat(${cols}, minmax(0, 1fr))` }}
      >
        <div className="space-y-6 border-e p-2 pt-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={cn(bar, "h-2.5 w-9")} />
          ))}
        </div>
        {Array.from({ length: cols }, (_, c) => (
          <div key={c} className="space-y-3 border-s p-2 pt-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className={cn(bar, "w-full")}
                style={{ height: `${[52, 34, 68][(c + i) % 3]}px` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Top-level tab button ──────────────────────────────────────────────────────

function PageTabButton({
  tabKey,
  icon: Icon,
  label,
  active,
  onClick,
  count,
}: {
  tabKey: PageTab;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      data-testid={`calendar-tab-${tabKey}`}
      onClick={onClick}
      className={cn(
        "relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
        active
          ? "bg-primary/10 text-primary ring-primary/20 ring-1"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {/* The gold thread marks the open tab — the frame's own way of saying "here". */}
      {active && (
        <span
          className="via-gold absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
          aria-hidden
        />
      )}
      <Icon className="size-4" />
      <span>{label}</span>
      {count != null && count > 0 && (
        <span className="bg-primary text-primary-foreground ms-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}
