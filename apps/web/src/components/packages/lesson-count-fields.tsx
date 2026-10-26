"use client";

import { useTranslations } from "next-intl";

/** The lesson lengths a desk sells, shortest first. */
export const LESSON_LENGTH_CHOICES = [20, 25, 30, 40, 45, 50, 60, 90, 120];

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/**
 * How much was bought, the way the desk counts it (2026-10-26): "8 lessons of 40 minutes", not
 * "5.33 hours". The hours are worked out from the two — a whole number of hours is no longer what
 * the form needs typed, which is what refused every 40- and 45-minute student before.
 */
export function LessonCountFields({
  lessons,
  onLessons,
  unitMinutes,
  onUnitMinutes,
  lessonsLabel,
  idPrefix,
}: {
  lessons: string;
  onLessons: (value: string) => void;
  unitMinutes: number;
  onUnitMinutes: (minutes: number) => void;
  lessonsLabel: string;
  idPrefix: string;
}) {
  const t = useTranslations("packages");
  const lengths = LESSON_LENGTH_CHOICES.includes(unitMinutes)
    ? LESSON_LENGTH_CHOICES
    : [...LESSON_LENGTH_CHOICES, unitMinutes].sort((a, b) => a - b);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-lessons`} className="text-sm font-medium">
          {lessonsLabel}
        </label>
        <input
          id={`${idPrefix}-lessons`}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={lessons}
          onChange={(e) => onLessons(e.target.value)}
          placeholder="8"
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-length`} className="text-sm font-medium">
          {t("form.lessonLength")}
        </label>
        <select
          id={`${idPrefix}-length`}
          className={inputClass}
          value={unitMinutes}
          onChange={(e) => onUnitMinutes(Number(e.target.value))}
          data-testid={`${idPrefix}-length`}
        >
          {lengths.map((m) => (
            <option key={m} value={m}>
              {t("form.minutesOption", { minutes: m })}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A whole number of lessons typed into the field, or null while it is empty or not one. */
export function lessonCountOf(lessons: string): number | null {
  const n = Number(lessons);
  return Number.isInteger(n) && n > 0 ? n : null;
}
