"use client";

import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MonthView } from "@/components/scheduling/calendar/month-view";
import { CalendarSummary, TimetablesSummary } from "@/components/scheduling/calendar/summary";
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
import { ScheduleSection } from "@/components/scheduling/schedule-editor";
import { SessionActions } from "@/components/scheduling/session-actions";
import { TimetableLogModal } from "@/components/scheduling/timetable-log-modal";
import { AlertBanner } from "@/components/ui/alert";
import { type ComboboxOption } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  type CalendarSession,
  getCalendar,
  listStudents,
  listTeachers,
  listTimetables,
  type StudentRow,
  type TeacherRow,
  type TimetableSummary,
} from "@/lib/api";

/**
 * The premium calendar (§5.5, AC-5.9). One session feed, four ways to read it — Month, Week,
 * Day and List — with a navigation toolbar, an at-a-glance summary strip, and a session
 * actions modal for reschedule/cancel/attendance. Every session renders at its time in the
 * VIEWER's timezone (the stored UTC never changes); a Teacher sees only their own sessions and
 * an Owner can pick any teacher (the server enforces both).
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

  // Teachers only see their own sessions — Month/Week/Day are all they need.
  const allowedViews: CalendarView[] = isTeacher
    ? ["month", "week", "day"]
    : ["month", "week", "day", "list"];

  const today = todayInTz(tz);
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(today);
  const [teacherId, setTeacherId] = useState("");
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [studentId, setStudentId] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [sessions, setSessions] = useState<CalendarSession[]>([]);
  const [selected, setSelected] = useState<CalendarSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Timetable list affordances (List view): update a student's recurring schedule,
  // read the full lesson log, or add a brand-new timetable.
  const [editStudent, setEditStudent] = useState<{ id: string; name: string } | null>(null);
  const [logStudent, setLogStudent] = useState<{ id: string; name: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // The List view is the academy's full timetable roster — period-independent, so it has its
  // own fetch (the recurring schedules, not the month's generated sessions).
  const [timetables, setTimetables] = useState<TimetableSummary[]>([]);
  const [ttLoading, setTtLoading] = useState(false);

  // The fetch window + the title both follow the active view.
  const { from, to, title } = useMemo(() => {
    switch (view) {
      case "month":
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
        return { from: addDays(anchor, -1), to: addDays(anchor, 1), title: dayLongLabel(anchor, locale) };
      default: {
        const ws = startOfWeek(anchor);
        return { from: ws, to: addDays(ws, 6), title: weekRangeLabel(ws, locale) };
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
    if (view !== "list") return;
    void loadTimetables();
  }, [view, loadTimetables]);

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
          <p className="text-muted-foreground text-sm">{t("calendar.subtitle")}</p>
        </div>
      </div>

      <CalendarToolbar
        t={t}
        title={title}
        view={view}
        onView={(v) => {
          if (isTeacher && v === "list") return;
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

      {view === "list" ? (
        <TimetablesSummary timetables={timetables} />
      ) : (
        <CalendarSummary sessions={sessions} />
      )}

      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}

      <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
        {view === "month" && (
          <MonthView
            anchor={anchor}
            sessions={sessions}
            tz={tz}
            today={today}
            onSelect={(s) => canOpenDetails && setSelected(s)}
            onDrillDay={openDay}
          />
        )}
        {(view === "week" || view === "day") && (
          <TimeGridView
            days={days}
            sessions={sessions}
            tz={tz}
            today={today}
            onSelect={(s) => canOpenDetails && setSelected(s)}
          />
        )}
        {view === "list" && (
          <TimetablesView
            timetables={timetables}
            loading={ttLoading}
            canManage={canManage}
            onUpdate={(id, name) => setEditStudent({ id, name })}
            onLog={(id, name) => setLogStudent({ id, name })}
            onAddNew={() => setAddOpen(true)}
          />
        )}
      </div>

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
