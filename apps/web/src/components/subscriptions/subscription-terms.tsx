"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { fieldClass } from "@/components/groups/group-format";
import { formatMoney } from "@/lib/money";
import { SUBSCRIPTION_LESSON_LENGTHS, type SellTerms } from "@/lib/subscriptions-api";
import { cn } from "@/lib/utils";

/** Major-unit text for an amount field ("100", "62.50"). */
export function majorText(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** A typed amount, in minor units; 0 while empty or not a number. */
export function minorOf(text: string): number {
  const n = Number.parseFloat((text || "0").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/** A whole number of lessons typed into the field, or null while it is empty or not one. */
export function lessonCountOf(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const OTHER = "other";

export interface SubscriptionTermsState {
  lessons: string;
  setLessons: (v: string) => void;
  /** Null = no expected length. */
  minutes: number | null;
  setMinutes: (v: number | null) => void;
  unitPrice: string;
  setUnitPrice: (v: string) => void;
  total: string;
  setTotal: (v: string) => void;
  label: string;
  setLabel: (v: string) => void;
  startsOn: string;
  setStartsOn: (v: string) => void;
  lessonsSold: number | null;
  lessonPriceMinor: number;
  priceMinor: number;
  valid: boolean;
  /** The block's terms, as POST /subscriptions (and POST /students) take them. */
  toTerms: () => Pick<SellTerms, "lessons_sold" | "lesson_minutes" | "lesson_price_minor" | "price_minor" | "label" | "starts_on">;
}

/**
 * What a block is sold as, the way a centre quotes it (docs/centre-profile/01 rule 1): so many
 * lessons, of an expected length, at a price per lesson — the total follows (sold × price) and can
 * still be typed over for a deal. One hook, so the new-student form, the enrolment wizard, the sell
 * form and the edit form all define "what a subscription needs" exactly once.
 */
export function useSubscriptionTerms(initial: {
  lessons?: number;
  minutes?: number | null;
  lessonPriceMinor?: number;
  priceMinor?: number;
  label?: string;
  startsOn?: string;
} = {}): SubscriptionTermsState {
  const [lessons, setLessons] = useState(initial.lessons !== undefined ? String(initial.lessons) : "");
  const [minutes, setMinutes] = useState<number | null>(initial.minutes === undefined ? 60 : initial.minutes);
  const [unitPrice, setUnitPriceRaw] = useState(initial.lessonPriceMinor !== undefined ? majorText(initial.lessonPriceMinor) : "");
  const [total, setTotalRaw] = useState(initial.priceMinor !== undefined ? majorText(initial.priceMinor) : "");
  // Once the total is typed by hand it stops following the lessons and the price.
  const [totalTouched, setTotalTouched] = useState(
    initial.priceMinor !== undefined && initial.lessons !== undefined && initial.lessonPriceMinor !== undefined && initial.priceMinor !== initial.lessons * initial.lessonPriceMinor,
  );
  const [label, setLabel] = useState(initial.label ?? "");
  const [startsOn, setStartsOn] = useState(initial.startsOn ?? "");

  const lessonsSold = lessonCountOf(lessons);
  const lessonPriceMinor = minorOf(unitPrice);
  const computed = lessonsSold !== null ? lessonsSold * lessonPriceMinor : 0;
  const priceMinor = totalTouched ? minorOf(total) : computed;

  const follow = (nextLessons: string, nextUnit: string) => {
    if (totalTouched) return;
    const n = lessonCountOf(nextLessons);
    setTotalRaw(n !== null && minorOf(nextUnit) > 0 ? majorText(n * minorOf(nextUnit)) : "");
  };

  return {
    lessons,
    setLessons: (v) => {
      setLessons(v);
      follow(v, unitPrice);
    },
    minutes,
    setMinutes,
    unitPrice,
    setUnitPrice: (v) => {
      setUnitPriceRaw(v);
      follow(lessons, v);
    },
    total,
    setTotal: (v) => {
      setTotalRaw(v);
      // Typing the computed total back is not a deal: the field keeps following.
      setTotalTouched(minorOf(v) !== computed);
    },
    label,
    setLabel,
    startsOn,
    setStartsOn,
    lessonsSold,
    lessonPriceMinor,
    priceMinor,
    valid: lessonsSold !== null && lessonPriceMinor >= 0 && priceMinor >= 0 && (unitPrice.trim() !== "" || totalTouched),
    toTerms: () => ({
      lessons_sold: lessonsSold ?? 0,
      lesson_minutes: minutes,
      lesson_price_minor: lessonPriceMinor,
      price_minor: priceMinor,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(startsOn ? { starts_on: startsOn } : {}),
    }),
  };
}

/**
 * The block's fields: lessons, the expected length (the usual lengths, or "other" and a number),
 * the price of one lesson, and the total — pre-filled from the two, editable for a deal.
 */
export function SubscriptionTermsFields({
  terms,
  currency,
  idPrefix,
  withLabel = false,
  withStart = false,
  startHint,
  minLessons,
}: {
  terms: SubscriptionTermsState;
  currency: string;
  idPrefix: string;
  withLabel?: boolean;
  withStart?: boolean;
  startHint?: string;
  /** Editing: the block may not shrink under what was already taught. */
  minLessons?: number;
}) {
  const t = useTranslations("subscriptions.terms");
  const locale = useLocale();
  const [other, setOther] = useState(() => terms.minutes !== null && !SUBSCRIPTION_LESSON_LENGTHS.includes(terms.minutes));
  const money = (minor: number) => (currency ? formatMoney({ amount: minor, currency }, locale) : majorText(minor));
  const lengthValue = other ? OTHER : terms.minutes === null ? "" : String(terms.minutes);
  const tooFew = minLessons !== undefined && terms.lessonsSold !== null && terms.lessonsSold < minLessons;

  return (
    <div className="space-y-3" data-testid={`${idPrefix}-terms`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("lessons")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={minLessons ?? 1}
            step="1"
            value={terms.lessons}
            onChange={(e) => terms.setLessons(e.target.value)}
            placeholder="8"
            className={fieldClass}
            data-testid={`${idPrefix}-lessons`}
          />
        </label>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-length`} className="text-sm font-medium">
            {t("length")}
          </label>
          <div className="flex gap-2">
            <select
              id={`${idPrefix}-length`}
              className={fieldClass}
              value={lengthValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === OTHER) {
                  setOther(true);
                  return;
                }
                setOther(false);
                terms.setMinutes(v === "" ? null : Number(v));
              }}
              data-testid={`${idPrefix}-length`}
            >
              {SUBSCRIPTION_LESSON_LENGTHS.map((m) => (
                <option key={m} value={m}>
                  {t("minutes", { minutes: m })}
                </option>
              ))}
              <option value={OTHER}>{t("otherLength")}</option>
            </select>
            {other && (
              <input
                type="number"
                inputMode="numeric"
                min="5"
                step="5"
                value={terms.minutes ?? ""}
                onChange={(e) => terms.setMinutes(e.target.value === "" ? null : Number(e.target.value))}
                aria-label={t("otherLength")}
                className={cn(fieldClass, "w-24")}
                data-testid={`${idPrefix}-length-other`}
              />
            )}
          </div>
        </div>
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("lessonPrice")}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={terms.unitPrice}
            onChange={(e) => terms.setUnitPrice(e.target.value)}
            placeholder="100"
            className={fieldClass}
            data-testid={`${idPrefix}-unit-price`}
          />
        </label>
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("total")}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={terms.total}
            onChange={(e) => terms.setTotal(e.target.value)}
            className={fieldClass}
            data-testid={`${idPrefix}-total`}
          />
        </label>
      </div>
      {terms.lessonsSold !== null && terms.lessonPriceMinor > 0 && (
        <p className="bg-primary/[0.07] text-primary rounded-xl px-3 py-2.5 text-center text-sm font-semibold" data-testid={`${idPrefix}-readout`}>
          {t("readout", { lessons: terms.lessonsSold, price: money(terms.lessonPriceMinor), total: money(terms.priceMinor) })}
          {terms.priceMinor !== terms.lessonsSold * terms.lessonPriceMinor && ` · ${t("dealNote")}`}
        </p>
      )}
      {tooFew && (
        <p className="text-destructive text-xs" data-testid={`${idPrefix}-too-few`}>
          {t("tooFew", { used: minLessons ?? 0 })}
        </p>
      )}
      {withLabel && (
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("label")}</span>
          <input value={terms.label} onChange={(e) => terms.setLabel(e.target.value)} placeholder={t("labelPlaceholder")} maxLength={80} className={fieldClass} data-testid={`${idPrefix}-label`} />
        </label>
      )}
      {withStart && (
        <label className="block space-y-1.5 text-sm font-medium">
          <span>{t("startsOn")}</span>
          <input type="date" value={terms.startsOn} onChange={(e) => terms.setStartsOn(e.target.value)} className={fieldClass} data-testid={`${idPrefix}-starts-on`} />
          <span className="text-muted-foreground block text-xs font-normal">{startHint ?? t("startsHint")}</span>
        </label>
      )}
    </div>
  );
}

export const NEW_SUBJECT = "__new__";

export interface SubjectOption {
  key: string;
  teacherId: string;
  course: string | null;
  label: string;
  /** This subject already holds an open block. */
  open?: boolean;
}

/**
 * Which subject the block is for: one the student already takes (teacher + course), or a new one —
 * then its teacher is picked and its name typed, and the link is made as the block opens.
 */
export function SubjectPicker({
  subjects,
  value,
  onChange,
  teachers,
  newTeacherId,
  onNewTeacherId,
  newCourse,
  onNewCourse,
  idPrefix,
  teachersLoading = false,
}: {
  subjects: SubjectOption[];
  value: string;
  onChange: (key: string) => void;
  teachers: { id: string; full_name: string }[];
  newTeacherId: string;
  onNewTeacherId: (id: string) => void;
  newCourse: string;
  onNewCourse: (course: string) => void;
  idPrefix: string;
  teachersLoading?: boolean;
}) {
  const t = useTranslations("subscriptions.subject");
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-subject`} className="text-sm font-medium">
        {t("label")}
      </label>
      <select id={`${idPrefix}-subject`} className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)} data-testid={`${idPrefix}-subject`}>
        {subjects.length === 0 && value === "" && <option value="">{t("pick")}</option>}
        {subjects.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
            {s.open ? ` ${t("open")}` : ""}
          </option>
        ))}
        <option value={NEW_SUBJECT}>{t("new")}</option>
      </select>
      {value === NEW_SUBJECT && (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-2" data-testid={`${idPrefix}-new-subject`}>
          <label className="text-muted-foreground block text-xs">
            {t("name")}
            <input className={cn(fieldClass, "mt-1")} value={newCourse} onChange={(e) => onNewCourse(e.target.value)} maxLength={80} placeholder={t("namePlaceholder")} data-testid={`${idPrefix}-new-course`} />
          </label>
          <label className="text-muted-foreground block text-xs">
            {t("teacher")}
            <select className={cn(fieldClass, "mt-1")} value={newTeacherId} onChange={(e) => onNewTeacherId(e.target.value)} data-testid={`${idPrefix}-new-teacher`}>
              <option value="">{teachersLoading ? "…" : t("teacherPick")}</option>
              {teachers.map((tc) => (
                <option key={tc.id} value={tc.id}>
                  {tc.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className="text-muted-foreground text-[11px]">{value === NEW_SUBJECT ? t("newHint") : t("hint")}</p>
    </div>
  );
}
