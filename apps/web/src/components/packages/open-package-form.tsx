"use client";

import { Info, Plus, Repeat, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  PackageTermsFields,
  usePackageTerms,
} from "@/components/packages/package-terms";
import { TopUpPackageForm } from "@/components/packages/top-up-package-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  ApiError,
  listLessonPackages,
  listPackageStudents,
  listTeachers,
  openLessonPackage,
  type LessonPackageRow,
  type PackageStudent,
  type TeacherRow,
} from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { formatMoney } from "@/lib/money";

/** One subject of a student: a teacher and what they teach them. A teacher can teach them two. */
export function subjectKey(teacherId: string, course?: string | null): string {
  return `${teacherId}::${(course ?? "").trim().toLowerCase()}`;
}

/**
 * Sell an existing student a block of hours.
 *
 * Opening a package also puts the student on package billing
 * ({@see LessonPackages::ensurePackageBilling} on the server), so the picker lists every student
 * and the note under it says so before the owner commits rather than after. It used to need a
 * trip to the student's profile first, to flip a toggle this screen could not see.
 *
 * The package fields themselves are {@link PackageTermsFields} — the same ones the new-student
 * form and the trial→active wizard show — so "what a package needs" is defined exactly once. What
 * is particular to THIS screen is choosing an existing student, the warnings that only make sense
 * for one, and carry-over, which needs an earlier package to carry hours from.
 */
export function OpenPackageForm({
  initialStudentId,
  initialSubjectId,
  studentsWithHistory,
  onSaved,
  onCancel,
}: {
  /** Pre-selects a student — set when the form is opened from that student's profile. */
  initialStudentId?: string;
  /** Pre-selects that subject (its teacher's id) — renewing a finished subscription for it. */
  initialSubjectId?: string;
  /** Students who have a closed package to carry hours over FROM. Others never see the option. */
  studentsWithHistory?: ReadonlySet<string>;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [students, setStudents] = useState<PackageStudent[] | null>(null);
  const [studentId, setStudentId] = useState(initialStudentId ?? "");
  const [carryOver, setCarryOver] = useState(false);
  // A centre sells one subscription per subject: tied to the student's teacher for it ("" = any lesson).
  const centre = useCapability("centre");
  const [subjectId, setSubjectId] = useState("");
  // A subject new to the student: its teacher and its name, linked to them as the block opens.
  const NEW = "__new__";
  const [teachers, setTeachers] = useState<TeacherRow[] | null>(null);
  const [newTeacherId, setNewTeacherId] = useState("");
  const [newCourse, setNewCourse] = useState("");

  const openKeysOf = (picked: PackageStudent | null | undefined) =>
    new Set((picked?.open_blocks ?? []).map((b) => subjectKey(b.teacher_id, b.course)));

  /**
   * Where the subject picker starts: "any lesson" — unless that one is already open, then their
   * first subject still free, else a new subject (a centre's second subscription is a subject).
   */
  function defaultSubject(picked: PackageStudent | undefined): string {
    if (!centre || picked?.active_package_id == null) return "";
    const open = openKeysOf(picked);
    const free = (picked.subjects ?? []).find((sub) => !open.has(subjectKey(sub.teacher_id, sub.course)));
    return free ? subjectKey(free.teacher_id, free.course) : NEW;
  }

  // Opened from a student's page: the student is chosen already, so start where a pick would.
  useEffect(() => {
    if (initialStudentId && students !== null) {
      const picked = students.find((s) => s.id === initialStudentId);
      const renewable = initialSubjectId !== undefined && centre
        && (picked?.subjects ?? []).some((sub) => subjectKey(sub.teacher_id, sub.course) === initialSubjectId)
        && !openKeysOf(picked).has(initialSubjectId);
      setSubjectId(renewable ? initialSubjectId : defaultSubject(picked));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  useEffect(() => {
    if (!centre || subjectId !== NEW || teachers !== null) return;
    void listTeachers({ pageSize: 200, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [centre, subjectId, teachers]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPackageStudents()
      .then((r) => setStudents(r.students))
      .catch(() => setStudents([]));
  }, []);

  const student = students?.find((s) => s.id === studentId) ?? null;

  const terms = usePackageTerms({
    defaultHourlyRateMinor: student?.default_hourly_rate_minor ?? 0,
    defaultCurrency: student?.currency ?? "",
    resetKey: studentId,
  });

  /** One line per student: which clock they are on today, and what it costs. */
  const studentOptions = useMemo(
    () =>
      (students ?? []).map((s) => ({
        value: s.id,
        label: s.full_name,
        sublabel:
          s.active_package_id !== null
            ? t("form.hasOpenPackage")
            : s.price_basis === null
              ? t("form.modeNone")
              : s.on_package_billing
                ? t("form.modePackage")
                : s.default_hourly_rate_minor > 0
                  ? t("form.modeMonthlyWithRate", {
                      rate: formatMoney(
                        {
                          amount: s.default_hourly_rate_minor,
                          currency: s.currency,
                        },
                        locale,
                      ),
                    })
                  : t("form.modeMonthly"),
      })),
    [students, t, locale],
  );

  const subjects = centre ? (student?.subjects ?? []) : [];
  const openKeys = openKeysOf(student);
  const tiedSubject = subjects.find((sub) => subjectKey(sub.teacher_id, sub.course) === subjectId);
  // The subject the block is tied to: one they already take, or the one picked as new.
  const tiedTeacher = subjectId === NEW ? newTeacherId : (tiedSubject?.teacher_id ?? "");
  const tiedCourse = subjectId === NEW ? newCourse : (tiedSubject?.course ?? null);
  const alreadyOpen =
    student !== null && (tiedTeacher === "" ? subjectId !== NEW && student.active_package_id != null : openKeys.has(subjectKey(tiedTeacher, tiedCourse)));
  // Another subject already open with this teacher: its lessons need telling apart on the timetable.
  const secondSubject = tiedTeacher !== "" && (student?.open_blocks ?? []).some((b) => b.teacher_id === tiedTeacher);
  // A subject holds one open block, so buying more with the same teacher means adding to that block.
  const [openBlocks, setOpenBlocks] = useState<LessonPackageRow[]>([]);
  const [topUp, setTopUp] = useState<LessonPackageRow | null>(null);
  const looksForBlock = centre && alreadyOpen;
  useEffect(() => {
    if (!looksForBlock || studentId === "") return;
    let live = true;
    void listLessonPackages({ student_id: studentId, scope: "open" })
      .then((r) => {
        if (live) setOpenBlocks(r.packages);
      })
      .catch(() => {
        if (live) setOpenBlocks([]);
      });
    return () => {
      live = false;
    };
  }, [looksForBlock, studentId]);
  const blockToAddTo = looksForBlock
    ? openBlocks.find(
        (p) =>
          p.student_id === studentId &&
          p.lesson_minutes !== null &&
          (p.subject ? subjectKey(p.subject.teacher_id, p.subject.course) : "") === (tiedTeacher === "" ? "" : subjectKey(tiedTeacher, tiedCourse)),
      ) ?? null
    : null;
  // How long this subject's lessons really are. The length starts there, and says so if changed.
  const timetableMinutes = centre
    ? ((tiedTeacher !== "" ? subjects.find((sub) => sub.teacher_id === tiedTeacher)?.lesson_minutes : student?.lesson_minutes) ?? null)
    : null;
  useEffect(() => {
    if (timetableMinutes !== null) terms.setUnitMinutes(timetableMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timetableMinutes]);
  const newSubjectReady = subjectId !== NEW || (newTeacherId !== "" && newCourse.trim() !== "");
  /** Saving will also move this student onto package billing. Said out loud, before they commit. */
  const willSwitch = student !== null && !student.on_package_billing;
  const canCarryOver =
    student !== null && (studentsWithHistory?.has(student.id) ?? false);

  const valid = studentId !== "" && terms.valid && !alreadyOpen && newSubjectReady;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await openLessonPackage({
        student_id: studentId,
        ...terms.toPayload(),
        carry_over: canCarryOver && carryOver,
        ...(tiedTeacher !== "" ? { teacher_id: tiedTeacher } : {}),
        ...(tiedCourse?.trim() ? { course: tiedCourse.trim() } : {}),
        // Picked as new with a teacher not already theirs: the link is made with the block.
        ...(subjectId === NEW && !subjects.some((sub) => sub.teacher_id === newTeacherId) ? { new_subject: true } : {}),
      });

      const opened =
        result.skipped_locked_lessons > 0
          ? t("alerts.openedWithLocked", {
              imported: result.imported_lessons,
              locked: result.skipped_locked_lessons,
            })
          : result.imported_lessons > 0
            ? t("alerts.openedWithLessons", { count: result.imported_lessons })
            : result.invoice_id !== null
              ? t("alerts.openedAndBilled")
              : t("alerts.opened");

      // The mode change is reported by the server, not assumed from the form: a second tab could
      // have moved this student already, and claiming a switch that did not happen is worse than
      // staying quiet about one that did.
      onSaved(
        [
          opened,
          result.switched_to_package_billing ? t("alerts.switchedToPackages", { name: student?.full_name ?? "" }) : null,
          secondSubject ? t("alerts.secondSubjectHint") : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (topUp !== null) {
    return <TopUpPackageForm row={topUp} onSaved={onSaved} onCancel={() => setTopUp(null)} />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      {/* ── Who ─────────────────────────────────────────────────────────
          Every active student, not only those already on package billing: the switch happens on
          save, so there is nothing to prepare elsewhere first. */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("form.student")}</span>
        <Combobox
          options={studentOptions}
          value={studentId}
          onChange={(id) => {
            setStudentId(id);
            setCarryOver(false);
            setSubjectId(defaultSubject(students?.find((s) => s.id === id)));
            setNewTeacherId("");
            setNewCourse("");
          }}
          placeholder={t("form.studentPlaceholder")}
          searchPlaceholder={t("form.searchStudent")}
          data-testid="package-student"
        />
        {students !== null && students.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {t("form.noStudents")}
          </p>
        )}
      </div>

      {centre && student !== null && (
        <div className="space-y-1.5">
          <label htmlFor="package-subject" className="text-sm font-medium">
            {t("form.subject")}
          </label>
          <select
            id="package-subject"
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            data-testid="package-subject"
          >
            <option value="">
              {t("form.subjectAny")}
              {student?.active_package_id != null ? ` ${t("form.subjectOpen")}` : ""}
            </option>
            {subjects.map((sub) => {
              const key = subjectKey(sub.teacher_id, sub.course);
              return (
                <option key={key} value={key}>
                  {[sub.course, sub.teacher_name].filter(Boolean).join(" · ")}
                  {openKeys.has(key) ? ` ${t("form.subjectOpen")}` : ""}
                </option>
              );
            })}
            <option value={NEW}>{t("form.subjectNew")}</option>
          </select>
          {subjectId === NEW && (
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-2" data-testid="package-new-subject">
              <label className="text-muted-foreground text-xs">
                {t("form.subjectName")}
                <input
                  className="border-input bg-background focus:border-primary focus:ring-primary/15 mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-3"
                  value={newCourse}
                  onChange={(e) => setNewCourse(e.target.value)}
                  maxLength={80}
                  placeholder={t("form.subjectNamePlaceholder")}
                  data-testid="package-new-course"
                />
              </label>
              <label className="text-muted-foreground text-xs">
                {t("form.subjectTeacher")}
                <select
                  className="border-input bg-background focus:border-primary focus:ring-primary/15 mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-3"
                  value={newTeacherId}
                  onChange={(e) => setNewTeacherId(e.target.value)}
                  data-testid="package-new-teacher"
                >
                  <option value="">{teachers === null ? "…" : t("form.subjectTeacherPick")}</option>
                  {(teachers ?? []).map((tc) => (
                    <option key={tc.id} value={tc.id}>
                      {tc.full_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <p className="text-muted-foreground text-[11px]">{subjectId === NEW ? t("form.subjectNewHint") : t("form.subjectHint")}</p>
        </div>
      )}

      {alreadyOpen && (
        <p
          className="bg-destructive/8 text-destructive flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-medium"
          data-testid="package-already-open"
        >
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {subjectId === "" ? t("form.alreadyOpen") : t("form.alreadyOpenSubject")}
        </p>
      )}

      {blockToAddTo !== null && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full gap-1.5"
          onClick={() => setTopUp(blockToAddTo)}
          data-testid="package-add-lessons"
        >
          <Plus className="size-3.5" aria-hidden />
          {t("topUp.action")}
        </Button>
      )}

      {willSwitch && !alreadyOpen && (
        <p
          className="flex items-start gap-2 rounded-xl border border-sky-300/60 bg-sky-500/[0.07] px-3 py-2.5 text-xs text-sky-800 dark:border-sky-800/50 dark:text-sky-300"
          data-testid="package-switch-note"
        >
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="block font-semibold">
              {t("form.switchTitle", { name: student.full_name })}
            </span>
            <span className="block opacity-90">{t("form.switchHint")}</span>
          </span>
        </p>
      )}

      {timetableMinutes !== null && terms.unitMinutes !== timetableMinutes && (
        <p
          className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400"
          data-testid="package-length-differs"
        >
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {t("form.lengthDiffers", { timetable: timetableMinutes, length: terms.unitMinutes })}
        </p>
      )}

      {/* ── What they bought ────────────────────────────────────────── */}
      <PackageTermsFields
        terms={terms}
        agreedCurrency={student?.currency}
        advancedExtra={
          // Carry-over is opt-in on purpose: unused minutes are the academy's to forgive or keep,
          // and moving them silently is how disputes start. It only appears for a student who HAS
          // a closed package to move hours from — an option that cannot do anything is one more
          // thing to wonder about.
          canCarryOver ? (
            <label className="border-input hover:bg-muted/30 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors">
              <input
                type="checkbox"
                checked={carryOver}
                onChange={(e) => setCarryOver(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1.5 font-medium">
                  <Repeat className="size-3.5" aria-hidden />
                  {t("form.carryOver")}
                </span>
                <span className="text-muted-foreground/80 block text-[11px]">
                  {t("form.carryOverHint")}
                </span>
              </span>
            </label>
          ) : null
        }
      />

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          {t("actions.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={busy || !valid}
          className="gap-1.5"
        >
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {t("actions.open")}
        </Button>
      </div>
    </div>
  );
}
