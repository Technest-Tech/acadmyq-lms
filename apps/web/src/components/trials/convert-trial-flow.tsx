"use client";

import { FlaskConical, GraduationCap, Sparkles, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { YesNo } from "@/components/attendance/cancellation-billing-modal";
import { useAuth } from "@/components/auth-provider";
import { StudentForm } from "@/components/students/student-form";
import { AlertBanner } from "@/components/ui/alert";
import { ApiError, convertTrial, type TrialRow } from "@/lib/api";

/**
 * Turns a completed trial into a real student. It reuses the standard student-creation form
 * (prefilled with the prospect's name + WhatsApp) so the owner just fills the missing pieces —
 * guardian and the rest — then a second call links the new student back to the trial
 * (status → CONVERTED). If the trial came from a CRM lead, that lead is subscribed by the same
 * call, so the pipeline never shows someone as a prospect after they have enrolled.
 *
 * The student is saved ENROLLED, not as another trial: the trial they are being converted from
 * is the one they already sat.
 *
 * An attended trial can also COUNT: on the student (off their package or onto their bill) and/or
 * for the teacher (on their statement). Both default to no, which is all a trial ever was. It is
 * the same money call as marking a lesson free, so only someone who may make that call is asked.
 */
export function ConvertTrialFlow({
  trial,
  onConverted,
  onCancel,
}: {
  trial: TrialRow;
  onConverted: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("trials");
  const locale = useLocale();
  const { can } = useAuth();
  const canCount = trial.status === "COMPLETED" && can("session.bill_override");
  const [chargeStudent, setChargeStudent] = useState(false);
  const [payTeacher, setPayTeacher] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(trial.scheduled_at_utc),
  );

  async function handleCreated(studentId: string) {
    try {
      await convertTrial(
        trial.id,
        studentId,
        canCount && (chargeStudent || payTeacher)
          ? { charge_student: chargeStudent, pay_teacher: payTeacher, reason: t("convert.count.reason") }
          : undefined,
      );
      onConverted();
    } catch (err) {
      // The student WAS created; only the link failed — tell the owner so they don't double-create.
      setError(err instanceof ApiError ? err.message : t("convert.linkFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-xs text-muted-foreground">{t("convert.intro")}</p>
      </div>

      {canCount && (
        <section className="space-y-2.5 rounded-xl border p-3.5" data-testid="convert-trial-count">
          <div className="flex items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              <FlaskConical className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("convert.count.title")}</p>
              <p className="text-muted-foreground text-xs">
                {t("convert.count.lesson", {
                  when,
                  minutes: trial.duration_minutes,
                  teacher: trial.teacher_name ?? "—",
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
              <UserRound className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("convert.count.student")}</p>
                <p className="text-muted-foreground text-xs">{t("convert.count.studentHint")}</p>
              </div>
            </div>
            <span data-testid="convert-trial-charge">
              <YesNo value={chargeStudent} onChange={setChargeStudent} />
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
              <GraduationCap className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("convert.count.teacher")}</p>
                <p className="text-muted-foreground text-xs">{t("convert.count.teacherHint")}</p>
              </div>
            </div>
            <span data-testid="convert-trial-pay">
              <YesNo value={payTeacher} onChange={setPayTeacher} />
            </span>
          </div>
        </section>
      )}

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <StudentForm
        intent="enrolled"
        initialFullName={trial.display_name ?? trial.lead_name ?? undefined}
        initialPhone={trial.contact_whatsapp ?? trial.lead_whatsapp}
        onCreated={handleCreated}
        onCancel={onCancel}
      />
    </div>
  );
}
