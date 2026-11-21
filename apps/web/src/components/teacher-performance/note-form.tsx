"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  createConductNote,
  updateConductNote,
  type ConductKind,
  type ConductNote,
  type PerformanceLesson,
  type PerformanceSettings,
} from "@/lib/api";
import { academyTimeZone, academyToday } from "@/lib/academy-clock";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";
import { INPUT_CLASS } from "./performance-ui";

export const CONDUCT_KINDS: readonly ConductKind[] = ["ABSENCE", "APOLOGY", "VIOLATION"];

/** Marks "another rule, typed in" in the rule picker. */
const OTHER = "__other__";

/**
 * A conduct note: the supervisor records an absence, an apology or a rule that was not kept. Each
 * kind shows what it costs before it is saved, so nobody is surprised by the month's number.
 *
 * Rendered as plain content, like the visit form.
 */
export function NoteForm({
  teacherId,
  settings,
  lessons,
  note,
  presetLessonId,
  presetKind,
  onSaved,
  onCancel,
}: {
  teacherId: string;
  settings: PerformanceSettings;
  lessons: PerformanceLesson[];
  /** Editing this note; absent when recording a new one. */
  note?: ConductNote;
  presetLessonId?: string;
  presetKind?: ConductKind;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("teacherPerformance.note");
  const locale = useLocale();
  const today = academyToday();

  const [kind, setKind] = useState<ConductKind>(note?.kind ?? presetKind ?? "ABSENCE");
  const [sessionId, setSessionId] = useState(note?.session_id ?? presetLessonId ?? "");
  const [day, setDay] = useState(note?.occurred_on ?? today);
  const knownRule = note?.rule != null && settings.rules.includes(note.rule);
  const [rulePick, setRulePick] = useState(note?.rule != null ? (knownRule ? note.rule : OTHER) : (settings.rules[0] ?? OTHER));
  const [ruleText, setRuleText] = useState(note?.rule != null && !knownRule ? note.rule : "");
  const [body, setBody] = useState(note?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lessonFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(numeralLocale(locale), {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: academyTimeZone(),
      }),
    [locale],
  );
  // A lesson is classified once; the one this note already names stays in the list.
  const options = lessons.filter((l) => !l.noted || l.id === note?.session_id);

  async function save() {
    const rule = kind === "VIOLATION" ? (rulePick === OTHER ? ruleText.trim() : rulePick) : null;
    if (kind === "VIOLATION" && !rule) {
      setError(t("needRule"));
      return;
    }
    setSaving(true);
    setError(null);
    const input = {
      kind,
      session_id: sessionId || null,
      occurred_on: sessionId ? null : day,
      rule,
      note: body.trim() || null,
    };
    try {
      if (note) await updateConductNote(note.id, input);
      else await createConductNote(teacherId, input);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("saveError"));
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="note-form"
    >
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t("kind")}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {CONDUCT_KINDS.map((k) => {
            // An edited note keeps the points it was written with unless its kind changes.
            const points = note && note.kind === k ? note.points : settings.points[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                data-testid={`note-kind-${k}`}
                className={cn(
                  "rounded-xl border px-3.5 py-3 text-start transition-colors",
                  kind === k ? "border-primary bg-primary/5 ring-primary/20 ring-2" : "hover:bg-muted/50",
                )}
              >
                <span className="block text-sm font-semibold">{t(`kinds.${k}`)}</span>
                <span className="text-muted-foreground mt-0.5 block text-xs">{t(`kindHint.${k}`)}</span>
                <span className={cn("mt-1.5 block text-xs font-semibold tabular-nums", points > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                  {points > 0 ? t("costs", { n: points }) : t("costsNothing")}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("lesson")}</span>
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            // The lesson a note is about is fixed once saved.
            disabled={note !== undefined}
            className={INPUT_CLASS}
            data-testid="note-lesson"
          >
            <option value="">{t("noLesson")}</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {lessonFmt.format(new Date(l.scheduled_at_utc))}
                {l.student_name ? ` · ${l.student_name}` : ""}
              </option>
            ))}
          </select>
        </label>
        {!sessionId && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("date")}</span>
            <input
              type="date"
              value={day}
              max={today}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className={INPUT_CLASS}
              data-testid="note-date"
            />
          </label>
        )}
      </div>

      {kind === "VIOLATION" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("rule")}</span>
            <select value={rulePick} onChange={(e) => setRulePick(e.target.value)} className={INPUT_CLASS} data-testid="note-rule">
              {settings.rules.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value={OTHER}>{t("ruleOther")}</option>
            </select>
          </label>
          {rulePick === OTHER && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("ruleText")}</span>
              <input
                value={ruleText}
                onChange={(e) => setRuleText(e.target.value)}
                maxLength={200}
                placeholder={t("ruleTextPh")}
                className={INPUT_CLASS}
                data-testid="note-rule-text"
              />
            </label>
          )}
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("details")}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t("detailsPh")}
          className={INPUT_CLASS}
          data-testid="note-details"
        />
      </label>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={saving} data-testid="note-save">
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
