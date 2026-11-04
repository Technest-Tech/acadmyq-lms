"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ASSESSMENT_KINDS,
  createAssessment,
  updateAssessment,
  type Assessment,
  type AssessmentInput,
  type AssessmentKind,
} from "@/lib/grades-api";

/**
 * One column of the grade sheet, typed in: a title, its kind, the day, the mark it is out of and
 * its weight in the total (1 unless the academy decides otherwise). Creates when `assessment` is
 * null, edits it otherwise.
 */
export function AssessmentForm({
  groupId,
  assessment,
  onSaved,
  onCancel,
}: {
  groupId: string;
  assessment: Assessment | null;
  onSaved: (a: Assessment) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("grades");
  const [title, setTitle] = useState(assessment?.title ?? "");
  const [kind, setKind] = useState<AssessmentKind>(assessment?.kind ?? "QUIZ");
  const [heldOn, setHeldOn] = useState(assessment?.held_on ?? "");
  const [maxScore, setMaxScore] = useState(assessment ? String(assessment.max_score) : "10");
  const [weight, setWeight] = useState(assessment ? String(assessment.weight) : "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input: AssessmentInput = {
      title: title.trim(),
      kind,
      held_on: heldOn || null,
      max_score: Number(maxScore),
      weight: weight === "" ? 1 : Number(weight),
    };
    try {
      const res = assessment ? await updateAssessment(groupId, assessment.id, input) : await createAssessment(groupId, input);
      onSaved(res.assessment);
    } catch (err) {
      setError(apiErrorMessage(err, t("form.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="assessment-form">
      {error && <AlertBanner variant="error" message={error} />}

      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t("form.title")}</span>
        <input
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("form.titlePlaceholder")}
          className={fieldClass}
          data-testid="assessment-title"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("form.kind")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as AssessmentKind)} className={fieldClass} data-testid="assessment-kind">
            {ASSESSMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("form.heldOn")}</span>
          <input type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} className={fieldClass} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("form.maxScore")}</span>
          <input
            required
            type="number"
            inputMode="decimal"
            min={0.5}
            step="0.5"
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            className={fieldClass}
            data-testid="assessment-max"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("form.weight")}</span>
          <input type="number" inputMode="decimal" min={0} step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} className={fieldClass} />
          <span className="text-muted-foreground block text-xs">{t("form.weightHint")}</span>
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={busy || title.trim() === "" || Number(maxScore) <= 0} data-testid="assessment-save">
          {t("form.save")}
        </Button>
      </div>
    </form>
  );
}
