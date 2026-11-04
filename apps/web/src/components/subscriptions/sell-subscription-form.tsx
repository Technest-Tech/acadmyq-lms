"use client";

import { CalendarClock, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { NEW_SUBJECT, SubjectPicker, SubscriptionTermsFields, useSubscriptionTerms, type SubjectOption } from "@/components/subscriptions/subscription-terms";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ApiError, listTeachers, type TeacherRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { fetchRoster } from "@/lib/roster";
import { listSubscriptionStudents, sellSubscription, subscriptionSubjectKey, type StudentPick, type SubscriptionRow } from "@/lib/subscriptions-api";

/**
 * A pay-first refusal (docs/centre-profile/01 rule 9): the API answers 422 naming the unpaid bill,
 * with no field errors. A validation error carries `errors`; a rule refusal does not.
 */
function isPayFirstRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 422) return false;
  const body = (err.body ?? {}) as { code?: string; errors?: Record<string, unknown>; pay_first?: boolean; renewal_held?: boolean };
  // The API names the bill it is waiting on (`errors.unpaid_invoice_id`), which is the refusal itself.
  return (
    body.code === "PAY_FIRST" ||
    body.pay_first === true ||
    body.renewal_held === true ||
    body.errors === undefined ||
    "unpaid_invoice_id" in body.errors ||
    "unpaid_subscription_id" in body.errors
  );
}

/**
 * Sell a student a block of lessons for one subject (POST /subscriptions). Renewing a finished block
 * is this same form with its terms and subject already filled (`prefill`), so the desk changes what
 * changed and presses sell. The warnings a student needs — the subject already open, no timetable
 * with that teacher yet, an earlier bill unpaid (pay-first) — are said before and after the save,
 * never swallowed: a lesson is never stopped, so this screen is where the pressure lives.
 */
export function SellSubscriptionForm({
  initialStudentId,
  initialSubjectKey,
  prefill,
  onSaved,
  onCancel,
}: {
  /** Pre-selects a student — set when opened from their profile. */
  initialStudentId?: string;
  /** Pre-selects that subject — renewing a finished subscription for it. */
  initialSubjectKey?: string;
  /** The finished block whose terms the new one starts from. */
  prefill?: SubscriptionRow | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("subscriptions.sell");
  const locale = useLocale();
  const [students, setStudents] = useState<StudentPick[] | null>(null);
  const [studentId, setStudentId] = useState(initialStudentId ?? prefill?.student.id ?? "");
  const [subjectKey, setSubjectKey] = useState(initialSubjectKey ?? (prefill ? subscriptionSubjectKey(prefill.teacher?.id ?? null, prefill.course) : ""));
  const [teachers, setTeachers] = useState<TeacherRow[] | null>(null);
  const [newTeacherId, setNewTeacherId] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [overridePayFirst, setOverridePayFirst] = useState(false);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terms = useSubscriptionTerms(
    prefill
      ? { lessons: prefill.lessons_sold, minutes: prefill.lesson_minutes, lessonPriceMinor: prefill.lesson_price_minor, priceMinor: prefill.price_minor }
      : {},
  );

  useEffect(() => {
    void listSubscriptionStudents()
      .then((r) => setStudents(r.rows))
      .catch(() => setStudents([]));
  }, []);

  useEffect(() => {
    if (subjectKey !== NEW_SUBJECT || teachers !== null) return;
    void fetchRoster(listTeachers, { filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [subjectKey, teachers]);

  const student = students?.find((s) => s.id === studentId) ?? null;
  const subjects = useMemo<SubjectOption[]>(
    () =>
      (student?.subjects ?? []).map((s) => ({
        key: subscriptionSubjectKey(s.teacher_id, s.course),
        teacherId: s.teacher_id,
        course: s.course,
        label: [s.course, s.teacher_name].filter(Boolean).join(" · "),
        open: s.open_subscription_id !== null,
      })),
    [student],
  );

  // A student freshly picked starts on their first subject with nothing open, else a new one.
  useEffect(() => {
    if (student === null) return;
    if (subjectKey !== "" && (subjectKey === NEW_SUBJECT || subjects.some((s) => s.key === subjectKey))) return;
    const free = subjects.find((s) => !s.open) ?? subjects[0];
    setSubjectKey(free ? free.key : NEW_SUBJECT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, subjects]);

  const chosen = subjects.find((s) => s.key === subjectKey) ?? null;
  const teacherId = subjectKey === NEW_SUBJECT ? newTeacherId : (chosen?.teacherId ?? "");
  const course = subjectKey === NEW_SUBJECT ? newCourse.trim() : (chosen?.course ?? null);
  const alreadyOpen = chosen?.open ?? false;
  const noTimetable = student !== null && teacherId !== "" && !student.has_timetable_for.includes(teacherId);
  const newSubjectReady = subjectKey !== NEW_SUBJECT || (newTeacherId !== "" && newCourse.trim() !== "");
  const valid = studentId !== "" && (subjectKey !== "" || subjects.length === 0) && terms.valid && !alreadyOpen && newSubjectReady;

  const studentOptions = useMemo(
    () => (students ?? []).map((s) => ({ value: s.id, label: s.full_name, sublabel: s.guardian_name ?? undefined })),
    [students],
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await sellSubscription({
        student_id: studentId,
        ...(teacherId !== "" ? { teacher_id: teacherId } : {}),
        ...(course ? { course } : {}),
        ...(subjectKey === NEW_SUBJECT && !subjects.some((s) => s.teacherId === newTeacherId) ? { new_subject: true } : {}),
        ...terms.toTerms(),
        ...(overridePayFirst ? { override_pay_first: true } : {}),
      });
      const sold =
        res.due_minor > 0
          ? t("soldDue", { amount: formatMoney({ amount: res.due_minor, currency: res.subscription.currency }, locale) })
          : t("sold");
      onSaved([sold, ...(res.warnings ?? [])].join(" "));
    } catch (err) {
      if (isPayFirstRefusal(err)) setHeld(true);
      setError(apiErrorMessage(err, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="sell-subscription-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("student")}</span>
        <Combobox
          options={studentOptions}
          value={studentId}
          onChange={(id) => {
            setStudentId(id);
            setSubjectKey("");
            setNewTeacherId("");
            setNewCourse("");
            setHeld(false);
            setOverridePayFirst(false);
          }}
          placeholder={t("studentPlaceholder")}
          searchPlaceholder={t("searchStudent")}
          disabled={initialStudentId !== undefined}
          data-testid="sell-student"
        />
        {students !== null && students.length === 0 && <p className="text-muted-foreground text-xs">{t("noStudents")}</p>}
      </div>

      {student !== null && (
        <SubjectPicker
          subjects={subjects}
          value={subjectKey}
          onChange={setSubjectKey}
          teachers={teachers ?? []}
          teachersLoading={subjectKey === NEW_SUBJECT && teachers === null}
          newTeacherId={newTeacherId}
          onNewTeacherId={setNewTeacherId}
          newCourse={newCourse}
          onNewCourse={setNewCourse}
          idPrefix="sell"
        />
      )}

      {alreadyOpen && (
        <p className="bg-destructive/8 text-destructive flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-medium" data-testid="sell-already-open">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {t("alreadyOpen")}
        </p>
      )}

      {noTimetable && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="sell-no-timetable">
          <CalendarClock className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {t("noTimetable")}{" "}
            <Link href={`/students/${studentId}?tab=schedule`} className="underline underline-offset-2">
              {t("openSchedule")}
            </Link>
          </span>
        </p>
      )}

      <SubscriptionTermsFields terms={terms} currency={prefill?.currency ?? ""} idPrefix="sell" withLabel withStart />

      {held && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-rose-300/60 bg-rose-500/[0.06] px-3 py-2.5 text-sm" data-testid="sell-override-pay-first">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={overridePayFirst} onChange={(e) => setOverridePayFirst(e.target.checked)} />
          <span>
            <span className="block font-medium">{t("overrideTitle")}</span>
            <span className="text-muted-foreground block text-[11px]">{t("overrideHint")}</span>
          </span>
        </label>
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy || !valid || (held && !overridePayFirst)} className="gap-1.5" data-testid="sell-confirm">
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {prefill ? t("renewConfirm") : t("confirm")}
        </Button>
      </div>
    </div>
  );
}
