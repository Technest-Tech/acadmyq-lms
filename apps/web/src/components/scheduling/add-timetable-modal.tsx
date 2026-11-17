"use client";

import { ClockField } from "@/components/scheduling/clock-field";
import {
  CalendarPlus,
  Clock,
  GraduationCap,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { studentOption } from "@/components/scheduling/student-options";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { LessonLengthWarning } from "@/components/scheduling/lesson-length-warning";
import {
  countPastLessons,
  StartDateField,
  todayLocal,
} from "@/components/scheduling/start-date-field";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  getStudentSchedule,
  putStudentSchedule,
  type ScheduleSlot,
  type StudentRow,
  type TeacherRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const fieldClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-60";

/** Backend bounds for a slot's length (ScheduleController: integer, min:1, max:600). */
const DURATION_MIN = 1;
const DURATION_MAX = 600;

/**
 * The "new student timetable" form (§5.1) as a focused modal: pick a student and the teacher the
 * timetable is with, build their recurring weekly slots, choose a timezone, and PUT the schedule
 * — the backend generates the concrete sessions and returns the created/removed counts. Reuses
 * the same slot model as the inline editor so a timetable created here is identical to one edited
 * from a student card.
 *
 * The teacher is always asked: a student may have several (one timetable each), and picking a
 * teacher the student does not have yet makes them one of the student's teachers.
 */
export function AddTimetableModal({
  students,
  teachers,
  onClose,
  onCreated,
}: {
  students: StudentRow[];
  teachers: TeacherRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("scheduling");
  const [studentId, setStudentId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  // "" = the academy's clock. Never the device's zone: a PC left on summer time used to tie the
  // timetable to whatever it was set to (Harare, Riyadh), and the lessons went with it.
  const [timezone, setTimezone] = useState("");
  const [studentClock, setStudentClock] = useState<{ country: string | null; timezone: string | null }>({ country: null, timezone: null });
  const [slots, setSlots] = useState<ScheduleSlot[]>([
    { weekday: 1, start_time_local: "17:00", duration_minutes: 30 },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The date the timetable starts producing lessons. Defaults to today, which is what the page
  // silently did before it was askable.
  const [startDate, setStartDate] = useState<string>(() => todayLocal());
  // A back-dated timetable writes history, so it takes a second, deliberate press.
  const [confirmingBackfill, setConfirmingBackfill] = useState(false);

  const studentOptions = useMemo(
    () =>
      students.map(studentOption),
    [students],
  );

  const weekdayOptions = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(`weekday.${d}`) })),
    [t],
  );

  // Where the picked student lives, so their own clock is one tap away.
  useEffect(() => {
    setStudentClock({ country: null, timezone: null });
    if (!studentId) return;
    let live = true;
    getStudentSchedule(studentId)
      .then((res) => live && setStudentClock({ country: res.student_country ?? null, timezone: res.student_timezone ?? null }))
      .catch(() => {
        // The clock field then simply offers no suggestion.
      });
    return () => {
      live = false;
    };
  }, [studentId]);

  function update(i: number, patch: Partial<ScheduleSlot>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  const student = students.find((s) => s.id === studentId);
  const studentName = student?.full_name ?? "";

  // The student's own teachers first, each with the course they teach them.
  const teacherOptions = useMemo(() => {
    const own = new Map(
      (student?.teachers ?? []).map((l) => [l.teacher_id, l.course]),
    );
    return [...teachers]
      .sort((a, b) => Number(own.has(b.id)) - Number(own.has(a.id)))
      .map((tch) => ({
        value: tch.id,
        label: tch.full_name,
        sublabel: own.get(tch.id) ?? undefined,
      }));
  }, [teachers, student]);

  function pickStudent(id: string) {
    setStudentId(id);
    const picked = students.find((s) => s.id === id);
    // Default to the student's first teacher; with several the user still chooses.
    setTeacherId(picked?.teacher_id ?? "");
    // The lesson their price assumes. Left at the flat default, a student priced at 40 minutes
    // gets 30-minute lessons, billed and paid at 30.
    if (picked?.lesson_minutes) {
      const minutes = picked.lesson_minutes;
      setSlots((prev) => prev.map((s) => ({ ...s, duration_minutes: minutes })));
    }
  }

  const pastLessons = countPastLessons(slots, startDate);

  /** Every slot needs a whole number of minutes the backend will accept. */
  const durationsValid = slots.every(
    (s) =>
      Number.isInteger(s.duration_minutes) &&
      s.duration_minutes >= DURATION_MIN &&
      s.duration_minutes <= DURATION_MAX,
  );

  async function submit() {
    if (!studentId) {
      setError(t("timetables.errStudent"));
      return;
    }
    if (!teacherId) {
      setError(t("timetables.errTeacher"));
      return;
    }
    if (slots.length === 0) {
      setError(t("timetables.errSlots"));
      return;
    }
    if (!durationsValid) {
      setError(t("timetables.errDuration", { min: DURATION_MIN, max: DURATION_MAX }));
      return;
    }
    if (pastLessons > 0 && !confirmingBackfill) {
      setConfirmingBackfill(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putStudentSchedule(studentId, {
        teacher_id: teacherId,
        timezone: timezone || undefined,
        start_date: startDate || undefined,
        slots: slots.map((s) => ({
          weekday: s.weekday,
          start_time_local: s.start_time_local,
          duration_minutes: s.duration_minutes,
        })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("timetables.addTitle")}
      description={t("timetables.addSubtitle")}
      size="lg"
    >
      <div className="space-y-5">
        {error && (
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        )}

        {/* Student picker */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <User className="size-3.5 text-muted-foreground" />
            {t("timetables.studentLabel")}
            <span className="text-destructive">*</span>
          </label>
          <Combobox
            options={studentOptions}
            value={studentId}
            onChange={pickStudent}
            placeholder={t("timetables.selectStudent")}
            searchPlaceholder={t("timetables.searchStudent")}
          />
        </div>

        {/* Teacher picker — a student with several teachers has one timetable per teacher */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <GraduationCap className="size-3.5 text-muted-foreground" />
            {t("timetables.teacherLabel")}
            <span className="text-destructive">*</span>
          </label>
          <Combobox
            options={teacherOptions}
            value={teacherId}
            onChange={setTeacherId}
            placeholder={t("timetables.selectTeacher")}
            searchPlaceholder={t("timetables.searchTeacher")}
            data-testid="timetable-teacher"
          />
          {(student?.teachers?.length ?? 0) > 1 && (
            <p className="text-muted-foreground text-xs">{t("timetables.teacherHint")}</p>
          )}
        </div>

        {/* Slot rows */}
        <div className="space-y-2.5">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            {t("timetable.recurringTitle")}
          </p>
          {slots.map((s, i) => (
            <div
              key={i}
              data-slot={i}
              className="grid grid-cols-1 items-end gap-3 rounded-xl border bg-muted/20 p-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div className="space-y-1">
                <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  {t("weekdayLabel")}
                </span>
                <Combobox
                  options={weekdayOptions}
                  value={String(s.weekday)}
                  onChange={(v) => update(i, { weekday: Number(v) })}
                  placeholder={t("weekdayLabel")}
                />
              </div>

              <div className="space-y-1">
                <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  {t("startTime")}
                </span>
                <div className="relative">
                  <Clock className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="time"
                    aria-label={t("startTime")}
                    className={cn(fieldClass, "w-full py-2 ps-9 pe-3")}
                    value={s.start_time_local}
                    onChange={(e) => update(i, { start_time_local: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  {t("duration")}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={DURATION_MIN}
                  max={DURATION_MAX}
                  step={5}
                  aria-label={t("duration")}
                  className={cn(fieldClass, "w-full px-3 py-2")}
                  value={s.duration_minutes || ""}
                  onChange={(e) =>
                    update(i, { duration_minutes: Number(e.target.value) })
                  }
                  placeholder={t("timetable.durationPlaceholder")}
                />
              </div>

              {slots.length > 1 ? (
                <button
                  type="button"
                  aria-label={t("removeSlot")}
                  onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                  className="flex size-10 items-center justify-center justify-self-end rounded-xl border text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}

          <LessonLengthWarning priced={student?.lesson_minutes} slots={slots} />

          <button
            type="button"
            data-testid="add-slot"
            onClick={() =>
              setSlots((prev) => [
                ...prev,
                {
                  weekday: 1,
                  start_time_local: "17:00",
                  // Same lesson as the others, unless someone says otherwise.
                  duration_minutes:
                    prev.at(-1)?.duration_minutes ?? student?.lesson_minutes ?? 30,
                },
              ])
            }
            className="group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            <span className="flex size-6 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
              <Plus className="size-4" />
            </span>
            {t("addSlot")}
          </button>
        </div>

        {/* Starts from — the date the lessons begin, which may be in the past. */}
        <StartDateField
          className="sm:max-w-xs"
          value={startDate}
          onChange={(v) => {
            setStartDate(v);
            setConfirmingBackfill(false);
          }}
          slots={slots}
          disabled={busy}
        />

        {/* Which clock the timetable is tied to: the academy's, or the student's country */}
        <ClockField
          className="sm:max-w-md"
          value={timezone}
          slots={slots}
          studentCountry={studentClock.country}
          studentTimezone={studentClock.timezone}
          disabled={busy}
          onChange={(tz, next) => {
            setTimezone(tz);
            setSlots(next);
          }}
        />

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("actions.acknowledge")}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="create-timetable"
            onClick={() => void submit()}
            disabled={
              busy || !studentId || !teacherId || slots.length === 0 || !durationsValid
            }
            className="gap-1.5"
          >
            {busy ? (
              <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <CalendarPlus className="size-3.5" />
            )}
            {confirmingBackfill
              ? t("startDateBackfillConfirm", { count: pastLessons })
              : `${t("timetables.create")}${studentName ? ` · ${studentName}` : ""}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
