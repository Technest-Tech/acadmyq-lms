"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** The lesson lengths a centre prices by — 60 and 40 first, the way the desk quotes them. */
export const LESSON_LENGTHS = [60, 40, 45, 30, 90, 120];

/** A price per lesson of `unitMinutes`, over `totalMinutes`, as the total in minor units. */
export function totalFromLessonPrice(unitPriceMinor: number, totalMinutes: number, unitMinutes: number): number {
  if (unitMinutes <= 0 || totalMinutes <= 0) return 0;
  return Math.round((unitPriceMinor * totalMinutes) / unitMinutes);
}

/** The other way round — a saved total read back as the price of one lesson. */
export function lessonPriceFromTotal(totalMinor: number, totalMinutes: number, unitMinutes: number): number {
  if (unitMinutes <= 0 || totalMinutes <= 0) return 0;
  return Math.round((totalMinor * unitMinutes) / totalMinutes);
}

/** Major-unit text for an amount field ("100", "62.50"). */
export function majorText(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/**
 * Priced the way a centre quotes it (2026-10-25): the length of one lesson and what it costs —
 * "40 minutes for 100" — and the system works out the total from the hours bought. Used by a
 * private subscription (hours in the block) and a monthly-by-hours group (hours a month).
 */
export function LessonPriceFields({
  unitMinutes,
  onUnitMinutes,
  unitPrice,
  onUnitPrice,
  totalMinutes,
  currency,
  idPrefix,
  className,
}: {
  unitMinutes: number;
  onUnitMinutes: (minutes: number) => void;
  unitPrice: string;
  onUnitPrice: (value: string) => void;
  /** Hours bought, in minutes (null/0 until they are typed). */
  totalMinutes: number | null;
  currency: string;
  idPrefix: string;
  className?: string;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const unitMinor = Math.round(Number.parseFloat((unitPrice || "0").replace(",", ".")) * 100);
  const lessons = totalMinutes && totalMinutes > 0 ? totalMinutes / unitMinutes : null;
  const total = totalMinutes && totalMinutes > 0 && unitMinor > 0 ? totalFromLessonPrice(unitMinor, totalMinutes, unitMinutes) : null;
  const money = (minor: number) => (currency ? formatMoney({ amount: minor, currency }, locale) : majorText(minor));
  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-unit`} className="text-sm font-medium">
            {t("form.lessonLength")}
          </label>
          <select
            id={`${idPrefix}-unit`}
            className={inputClass}
            value={unitMinutes}
            onChange={(e) => onUnitMinutes(Number(e.target.value))}
            data-testid={`${idPrefix}-unit`}
          >
            {(LESSON_LENGTHS.includes(unitMinutes) ? LESSON_LENGTHS : [unitMinutes, ...LESSON_LENGTHS]).map((m) => (
              <option key={m} value={m}>
                {t("form.minutesOption", { minutes: m })}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-unit-price`} className="text-sm font-medium">
            {t("form.lessonPrice", { minutes: unitMinutes })}
          </label>
          <input
            id={`${idPrefix}-unit-price`}
            type="number"
            min="0"
            step="0.01"
            value={unitPrice}
            onChange={(e) => onUnitPrice(e.target.value)}
            placeholder="100"
            className={inputClass}
            data-testid={`${idPrefix}-unit-price`}
          />
        </div>
      </div>
      {total !== null && lessons !== null && (
        <p className="bg-primary/[0.07] text-primary rounded-xl px-3 py-2.5 text-center text-sm font-semibold" data-testid={`${idPrefix}-total`}>
          {t("form.lessonTotal", {
            total: money(total),
            lessons: Number.isInteger(lessons) ? lessons : lessons.toLocaleString(locale, { maximumFractionDigits: 1 }),
            price: money(unitMinor),
          })}
        </p>
      )}
    </div>
  );
}
