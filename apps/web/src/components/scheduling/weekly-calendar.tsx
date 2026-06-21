"use client";

import { CalendarDays, Users } from "lucide-react";
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
import { CalendarFilters } from "@/components/scheduling/calendar/calendar-filters";
import { MonthView } from "@/components/scheduling/calendar/month-view";
import {
  CalendarSummary,
  TimetablesSummary,
} from "@/components/scheduling/calendar/summary";
import { TimeGridView } from "@/components/scheduling/calendar/time-grid-view";
import { CalendarToolbar } from "@/components/scheduling/calendar/toolbar";
import { TimetablesView } from "@/components/scheduling/calendar/timetables-view";
import {
  addDays,
  addMonths,
  type CalendarView,
  dayLongLabel,
  endUtc,
  monthGridDays,
  monthYearLabel,
  startOfMonth,
  startOfWeek,
  todayInTz,
  timeInTz,
  weekRangeLabel,
} from "@/components/scheduling/calendar/utils";
import { AddTimetableModal } from "@/components/scheduling/add-timetable-modal";
import { QuickCreateModal } from "@/components/scheduling/quick-create-modal";
import { ScheduleSection } from "@/components/scheduling/schedule-editor";
import { SessionActions } from "@/components/scheduling/session-actions";
import { TimetableLogModal } from "@/components/scheduling/timetable-log-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  type CalendarSession,
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
 *   • Calendar — one session feed, three ways to read it (Month, Week, Day) with a navigation
 *     toolbar, an at-a-glance summary strip, and a session actions modal.
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

  // The recurring-timetable roster lives in its own tab; the calendar feed is always
  // Month/Week/Day. Teachers only ever see the Calendar tab (their own sessions).
  const allowedViews: CalendarView[] = ["month", "week", "day"];

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
      case "month": {
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSessions([]);
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
    if (!canPickTeacher) return;
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [canPickTeacher]);

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
        if (view === "month") return addMonths(a, dir);
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

  // Apply the search + status filters to the fetched feed (everything downstream — views and
  // the summary strip — reads this so the numbers always match what's on screen).
  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (statuses.size > 0 && !statuses.has(s.status)) return false;
      if (!q) return true;
      return (
        (s.student_name ?? "").toLowerCase().includes(q) ||
        (s.teacher_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [sessions, query, statuses]);

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

  return (
    <div className="space-y-4" data-testid="weekly-calendar">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
          <CalendarDays className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("calendar.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("calendar.subtitle")}
          </p>
        </div>
      </div>

      {/* ── Top-level tabs (teachers get the Calendar tab only) ──────────── */}
      {!isTeacher && (
        <div
          role="tablist"
          className="bg-muted/40 flex gap-1 rounded-2xl border p-1.5"
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
          />

          <CalendarFilters
            t={t}
            query={query}
            onQuery={setQuery}
            statuses={statuses}
            onToggleStatus={toggleStatus}
            onClear={() => setStatuses(new Set())}
          />

          <CalendarSummary sessions={visibleSessions} />

          <div
            className={
              loading ? "opacity-60 transition-opacity" : "transition-opacity"
            }
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
              />
            )}
            {(view === "week" || view === "day") && (
              <TimeGridView
                days={days}
                sessions={visibleSessions}
                tz={tz}
                today={today}
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
          </div>
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

      {/* Session actions modal */}
      {selected && canOpenDetails && (
        <Modal
          open
          onClose={() => setSelected(null)}
          title={selected.student_name ?? t("calendar.title")}
          description={`${dayLongLabel(
            new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
              new Date(selected.scheduled_at_utc),
            ),
            locale,
          )} · ${timeInTz(selected.scheduled_at_utc, tz, locale)} – ${timeInTz(
            endUtc(selected),
            tz,
            locale,
          )}`}
          size="md"
        >
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
        "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-card shadow-sm ring-1 ring-black/5"
          : "text-muted-foreground hover:bg-card/50",
      )}
    >
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
