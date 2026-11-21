"use client";

import { Loader2, Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  createLessonVisit,
  updateLessonVisit,
  type LessonVisit,
  type PerformanceLesson,
  type PerformanceSettings,
} from "@/lib/api";
import { academyTimeZone, academyToday } from "@/lib/academy-clock";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";
import { INPUT_CLASS, Meter, scoreText } from "./performance-ui";

/**
 * A lesson visit: the supervisor sat in a lesson and rates it out of five on each item of the
 * academy's list, with what went well and what to work on. The result is shown as it is built —
 * five out of five on everything is 100.
 *
 * Rendered as plain content: the teacher's detail swaps it in place of its own body, so there is
 * never a dialog on top of a dialog.
 */
export function VisitForm({
  teacherId,
  settings,
  lessons,
  visit,
  presetLessonId,
  onSaved,
  onCancel,
}: {
  teacherId: string;
  settings: PerformanceSettings;
  /** The teacher's lessons this month, to say which one was visited. */
  lessons: PerformanceLesson[];
  /** Editing this visit; absent when recording a new one. */
  visit?: LessonVisit;
  presetLessonId?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("teacherPerformance.visit");
  const locale = useLocale();
  const today = academyToday();

  // An old visit may hold an item the academy has since removed — it stays editable on its visit.
  const criteria = useMemo(() => {
    const list = [...settings.criteria];
    for (const item of visit?.items ?? []) {
      if (!list.some((c) => c.id === item.criterion_id)) list.push({ id: item.criterion_id, name: item.name });
    }
    return list;
  }, [settings.criteria, visit]);

  const [sessionId, setSessionId] = useState(visit?.session_id ?? presetLessonId ?? "");
  const [day, setDay] = useState(visit?.visited_on ?? today);
  const [ratings, setRatings] = useState<Record<string, number>>(
    () => Object.fromEntries((visit?.items ?? []).map((i) => [i.criterion_id, i.rating])),
  );
  const [strengths, setStrengths] = useState(visit?.strengths ?? "");
  const [improvements, setImprovements] = useState(visit?.improvements ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lessonFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(numeralLocale(locale), {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: academyTimeZone(),
      }),
    [locale],
  );
  // A lesson that never happened cannot have been sat in.
  const options = lessons.filter((l) => !l.status.startsWith("CANCELLED"));

  const rated = criteria.filter((c) => ratings[c.id] !== undefined);
  const score = rated.length > 0 ? Math.round((rated.reduce((sum, c) => sum + ratings[c.id]!, 0) / (rated.length * 5)) * 100) : null;

  async function save() {
    if (rated.length === 0) {
      setError(t("needOne"));
      return;
    }
    setSaving(true);
    setError(null);
    const input = {
      session_id: sessionId || null,
      visited_on: sessionId ? null : day,
      ratings: rated.map((c) => ({ criterion_id: c.id, rating: ratings[c.id]! })),
      strengths: strengths.trim() || null,
      improvements: improvements.trim() || null,
    };
    try {
      if (visit) await updateLessonVisit(visit.id, input);
      else await createLessonVisit(teacherId, input);
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
      data-testid="visit-form"
    >
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("lesson")}</span>
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            // The lesson a visit is about is fixed once saved.
            disabled={visit !== undefined}
            className={INPUT_CLASS}
            data-testid="visit-lesson"
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
              data-testid="visit-date"
            />
          </label>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">{t("rate")}</legend>
        <p className="text-muted-foreground mt-0.5 text-xs">{t("rateHint")}</p>
        <ul className="divide-border/60 mt-2 divide-y rounded-xl border">
          {criteria.map((c) => {
            const value = ratings[c.id];
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3.5 py-2.5" data-testid={`visit-criterion-${c.id}`}>
                <span className="min-w-0 text-sm font-medium">{c.name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground w-16 text-end text-xs">{value ? t(`rating.${value}`) : ""}</span>
                  <span className="flex" role="group" aria-label={c.name}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        // Pressing the chosen rating again clears it: the item was not observed.
                        onClick={() =>
                          setRatings((r) => {
                            const next = { ...r };
                            if (r[c.id] === n) delete next[c.id];
                            else next[c.id] = n;
                            return next;
                          })
                        }
                        aria-label={t("ratingAria", { n })}
                        aria-pressed={value === n}
                        className="focus-visible:ring-primary rounded p-1 outline-none focus-visible:ring-2"
                      >
                        <Star
                          className={cn(
                            "size-5 transition-colors",
                            value !== undefined && n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
                          )}
                          aria-hidden
                        />
                      </button>
                    ))}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="bg-muted/40 rounded-xl px-3.5 py-3" data-testid="visit-score">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground text-xs font-medium">{t("result")}</span>
          <span className={cn("text-xl font-bold tabular-nums", scoreText(score))}>
            {score === null ? t("resultEmpty") : t("resultOf", { score })}
          </span>
        </div>
        <Meter score={score} className="mt-2.5" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("strengths")}</span>
          <textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t("strengthsPh")}
            className={INPUT_CLASS}
            data-testid="visit-strengths"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("improvements")}</span>
          <textarea
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t("improvementsPh")}
            className={INPUT_CLASS}
            data-testid="visit-improvements"
          />
        </label>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={saving} data-testid="visit-save">
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
