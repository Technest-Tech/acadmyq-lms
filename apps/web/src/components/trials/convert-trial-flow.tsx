"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
  const [error, setError] = useState<string | null>(null);

  async function handleCreated(studentId: string) {
    try {
      await convertTrial(trial.id, studentId);
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

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <StudentForm
        intent="enrolled"
        initialFullName={trial.display_name ?? trial.lead_name ?? undefined}
        initialPhone={trial.lead_whatsapp}
        onCreated={handleCreated}
        onCancel={onCancel}
      />
    </div>
  );
}
