"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { SubscriptionTermsFields, useSubscriptionTerms } from "@/components/subscriptions/subscription-terms";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { listTeachers, type TeacherRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { fetchRoster } from "@/lib/roster";
import { updateSubscription, type SubscriptionRow } from "@/lib/subscriptions-api";

/**
 * Everything on an open block is editable (docs/centre-profile/01 rule 5): its teacher and course
 * (its lessons move with it), the start date, the lessons sold (a top-up is sold upward; a
 * finished block reopens the same way), the price, the length, the label. The bill line is
 * re-issued in place — the response says what came back as credit or is now due, and the notice
 * repeats it. The floor under the lessons is what was already taught: closing is the operation for
 * "it ends here".
 */
export function EditSubscriptionForm({ row, onSaved, onCancel }: { row: SubscriptionRow; onSaved: (message: string) => void; onCancel: () => void }) {
  const t = useTranslations("subscriptions.edit");
  const locale = useLocale();
  const terms = useSubscriptionTerms({
    lessons: row.lessons_sold,
    minutes: row.lesson_minutes,
    lessonPriceMinor: row.lesson_price_minor,
    priceMinor: row.price_minor,
    label: row.label,
    startsOn: row.starts_on,
  });
  const [teachers, setTeachers] = useState<TeacherRow[] | null>(null);
  const [teacherId, setTeacherId] = useState(row.teacher?.id ?? "");
  const [course, setCourse] = useState(row.course ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRoster(listTeachers, { filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, []);

  const money = (minor: number) => formatMoney({ amount: minor, currency: row.currency }, locale);
  const tooFew = terms.lessonsSold !== null && terms.lessonsSold < row.lessons_used;
  const valid = terms.valid && !tooFew && terms.startsOn !== "";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const { label, starts_on, ...block } = terms.toTerms();
      const res = await updateSubscription(row.id, {
        ...block,
        label: label ?? row.label,
        starts_on,
        teacher_id: teacherId || null,
        course: course.trim() || null,
      });
      const moved = res.moved_lessons > 0 ? ` ${t("movedLessons", { count: res.moved_lessons })}` : "";
      onSaved(
        (res.credited_minor > 0 ? t("savedCredit", { amount: money(res.credited_minor) }) : res.due_minor > 0 ? t("savedDue", { amount: money(res.due_minor) }) : t("saved")) + moved,
      );
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="edit-subscription-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* What is already taught, said before the fields that must respect it. */}
      <p className="bg-muted/40 text-muted-foreground rounded-xl px-3 py-2.5 text-xs">{t("used", { used: row.lessons_used, sold: row.lessons_sold })}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("teacher")}</span>
          <select className={fieldClass} value={teacherId} onChange={(e) => setTeacherId(e.target.value)} data-testid="edit-teacher">
            <option value="">{teachers === null ? "…" : t("untied")}</option>
            {(teachers ?? []).map((tc) => (
              <option key={tc.id} value={tc.id}>
                {tc.full_name}
              </option>
            ))}
            {teachers !== null && row.teacher && !teachers.some((tc) => tc.id === row.teacher?.id) && <option value={row.teacher.id}>{row.teacher.full_name}</option>}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("course")}</span>
          <input className={fieldClass} value={course} onChange={(e) => setCourse(e.target.value)} maxLength={80} placeholder={t("coursePlaceholder")} data-testid="edit-course" />
        </label>
      </div>

      <SubscriptionTermsFields terms={terms} currency={row.currency} idPrefix="edit" withLabel withStart startHint={t("startsHint")} minLessons={row.lessons_used} />

      {row.invoice_id !== null && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="edit-bill-note">
          {row.invoice_paid_minor > 0 ? t("billNotePaid", { amount: money(row.invoice_paid_minor) }) : t("billNote")}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy || !valid} className="gap-1.5" data-testid="edit-confirm">
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("confirm")}
        </Button>
      </div>
    </div>
  );
}
