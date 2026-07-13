"use client";

import { CalendarPlus, Loader2, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  type AttendanceOutcome,
  createSession,
  listStudents,
  listTeachers,
  markAttendance,
  putSessionReport,
  type SchedulingWarning,
  type StudentRow,
  type TeacherRow,
} from "@/lib/api";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/** "SCHEDULED" means "created, outcome not recorded yet" — the only non-outcome choice. */
type ClassStatus = "SCHEDULED" | AttendanceOutcome;

const CANCEL_STATUSES: ClassStatus[] = ["CANCELLED_BY_TEACHER", "CANCELLED_BY_STUDENT"];

/** `YYYY-MM-DDTHH:mm` for the given day at the current wall-clock time. */
function defaultWhen(day: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${day}T${hh}:${mm}`;
}

/**
 * Add a one-off class the weekly timetable never produced — a make-up lesson, or one that
 * happened before the timetable existed and so was never generated (the generator never
 * back-fills the past). Owners pick any teacher; a TEACHER is confined by the API to their own
 * roster with themselves as the teacher.
 *
 * There is no bespoke "ad-hoc class" concept behind this: it composes the three endpoints a
 * normal session already uses — create, record the outcome, save the report — so the class is
 * billed, reported and listed exactly like a generated one, with no parallel billing path.
 */
export function CreateClassModal({
  day,
  timeZone,
  open,
  onClose,
  onCreated,
}: {
  /** The day currently on screen — the new class defaults to it. */
  day: string;
  timeZone?: string;
  open: boolean;
  onClose: () => void;
  /** The class landed — the caller should reload the day. */
  onCreated: () => void;
}) {
  const t = useTranslations("attendance");
  const tSched = useTranslations("scheduling");
  const { session: auth, can } = useAuth();
  const isTeacher = auth?.role === "TEACHER";
  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const [teacherId, setTeacherId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [when, setWhen] = useState(() => defaultWhen(day));
  const [duration, setDuration] = useState(60);
  const [status, setStatus] = useState<ClassStatus>("ATTENDED");
  const [chargeStudent, setChargeStudent] = useState(false);
  const [payTeacher, setPayTeacher] = useState(false);
  const [description, setDescription] = useState("");

  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SchedulingWarning[]>([]);
  // Set once the session row exists. A retry after a failed outcome/report must reuse it rather
  // than minting a second class.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [canOverrideTiming, setCanOverrideTiming] = useState(false);

  // Only the outcomes this viewer may actually apply. A TEACHER cannot cancel or gift a lesson
  // directly — the API makes them raise a request for the owner — so offering those here would
  // just be a 422 waiting to happen.
  const statuses = useMemo(() => {
    const list: ClassStatus[] = ["ATTENDED"];
    if (can("session.free")) list.push("FREE");
    if (can("session.cancel")) list.push(...CANCEL_STATUSES);
    list.push("SCHEDULED");
    return list;
  }, [can]);

  // Re-arm the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTeacherId("");
    setStudentId("");
    setWhen(defaultWhen(day));
    setDuration(60);
    setStatus("ATTENDED");
    setChargeStudent(false);
    setPayTeacher(false);
    setDescription("");
    setError(null);
    setWarnings([]);
    setCreatedId(null);
    setCanOverrideTiming(false);
  }, [open, day]);

  useEffect(() => {
    if (!open || isTeacher) return;
    void listTeachers({ pageSize: 100, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [open, isTeacher]);

  // A teacher's roster is scoped server-side, so they need no teacher picker; an owner must pick
  // the teacher first, and the student list is then that teacher's roster.
  useEffect(() => {
    if (!open) return;
    if (!isTeacher && !teacherId) {
      setStudents(null);
      return;
    }
    setStudents(null);
    void listStudents({
      pageSize: 200,
      filter: isTeacher ? {} : { teacher_id: teacherId },
    })
      .then((r) => setStudents(r.rows))
      .catch(() => setStudents([]));
  }, [open, isTeacher, teacherId]);

  const isCancel = CANCEL_STATUSES.includes(status);
  const canSubmit = !!studentId && !!when && duration > 0 && !busy;

  async function submit(overrideTiming = false) {
    if (!canSubmit && !createdId) return;
    setBusy(true);
    setError(null);
    setCanOverrideTiming(false);
    try {
      // 1) The class itself. Reuse the row if a previous attempt already created it.
      let sessionId = createdId;
      if (sessionId === null) {
        const res = await createSession({
          student_id: studentId,
          ...(isTeacher || !teacherId ? {} : { teacher_id: teacherId }),
          local_datetime: when.replace("T", " "),
          timezone: tz,
          duration_minutes: duration,
        });
        sessionId = res.sessionId;
        setCreatedId(sessionId);
        setWarnings(res.warnings ?? []);
      }

      // 2) The outcome — the same endpoint the attendance rows use, so the billing hook fires
      //    identically and the invoice/payout pick it up with no special-casing.
      if (status !== "SCHEDULED") {
        await markAttendance(sessionId, {
          status,
          ...(isCancel ? { charge_student: chargeStudent, pay_teacher: payTeacher } : {}),
          ...(overrideTiming ? { override_timing: true } : {}),
        });
      }

      // 3) The free-text report body (`report_text` is the reserved free-text key the report
      //    endpoint already understands, so it reads back like any other session's report).
      if (description.trim()) {
        await putSessionReport(sessionId, { report_text: description.trim() });
      }

      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      // Recording an outcome on a class that hasn't started yet is refused (422). An owner may
      // override that; a teacher may not.
      if (err instanceof ApiError && err.status === 422 && !isTeacher) {
        setCanOverrideTiming(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("createClassTitle")}
      description={t("createClassSubtitle")}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("close")}
          </Button>
          <Button
            type="button"
            data-testid="do-create-class"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <CalendarPlus className="size-3.5" aria-hidden />
            )}
            {t("createClassAdd")}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="create-class-modal">
        {/* Teacher — owners only; a teacher is always the teacher of their own class. */}
        {!isTeacher && (
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">{t("teacher")}</span>
            <select
              aria-label={t("teacher")}
              data-testid="create-class-teacher"
              className={inputClass}
              value={teacherId}
              onChange={(e) => {
                setTeacherId(e.target.value);
                setStudentId("");
              }}
            >
              <option value="">{t("createClassPickTeacher")}</option>
              {teachers.map((tch) => (
                <option key={tch.id} value={tch.id}>
                  {tch.full_name}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Student — that teacher's roster */}
        <label className="block space-y-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            {t("colStudent")}
          </span>
          <select
            aria-label={t("colStudent")}
            data-testid="create-class-student"
            className={inputClass}
            value={studentId}
            disabled={students === null}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">
              {students === null
                ? t("createClassPickTeacherFirst")
                : students.length === 0
                  ? t("createClassNoStudents")
                  : t("createClassPickStudent")}
            </option>
            {(students ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </label>

        {/* When + how long */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("createClassWhen")}
            </span>
            <input
              type="datetime-local"
              aria-label={t("createClassWhen")}
              data-testid="create-class-when"
              className={inputClass}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("colDuration")}
            </span>
            <input
              type="number"
              min={1}
              max={600}
              aria-label={t("colDuration")}
              data-testid="create-class-duration"
              className={inputClass}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
        </div>

        {/* Outcome */}
        <label className="block space-y-1.5">
          <span className="text-muted-foreground text-xs font-medium">{t("status")}</span>
          <select
            aria-label={t("status")}
            data-testid="create-class-status"
            className={inputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as ClassStatus)}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {tSched(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>

        {/* Cancellation billing — the same two decisions the cancellation popup asks for. */}
        {isCancel && (
          <div className="border-destructive/20 bg-destructive/5 space-y-2 rounded-xl border p-3">
            <p className="text-muted-foreground text-xs">{t("createClassCancelBilling")}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="create-class-charge-student"
                checked={chargeStudent}
                onChange={(e) => setChargeStudent(e.target.checked)}
              />
              {t("billsStudent")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="create-class-pay-teacher"
                checked={payTeacher}
                onChange={(e) => setPayTeacher(e.target.checked)}
              />
              {t("paysTeacher")}
            </label>
          </div>
        )}

        {/* Free-text report */}
        <label className="block space-y-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            {t("createClassDescription")}
          </span>
          <textarea
            rows={4}
            aria-label={t("createClassDescription")}
            data-testid="create-class-description"
            placeholder={t("reportPlaceholder")}
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        {error && (
          <div className="space-y-2">
            <p
              role="alert"
              data-testid="create-class-error"
              className="text-destructive border-destructive/20 bg-destructive/5 rounded-xl border px-3 py-2 text-xs font-medium"
            >
              {/* Once the row exists, a bare error would read as "nothing happened" and invite a
                  retry that mints a duplicate class. Name what did land. */}
              {createdId !== null ? `${t("createClassPartial")} ${error}` : error}
            </p>
            {canOverrideTiming && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="create-class-override"
                disabled={busy}
                onClick={() => void submit(true)}
              >
                {t("overrideTiming")}
              </Button>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="space-y-1.5" data-testid="create-class-warnings">
            {warnings.map((w, i) => (
              <li
                key={i}
                role="alert"
                data-warning={w.type}
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
