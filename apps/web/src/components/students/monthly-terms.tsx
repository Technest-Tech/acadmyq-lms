"use client";

import { Gift } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { LessonCountFields, lessonCountOf } from "@/components/packages/lesson-count-fields";
import { majorText } from "@/components/packages/lesson-price-fields";
import { Combobox } from "@/components/ui/combobox";
import type { SubscriptionInput } from "@/lib/api";
import { CURRENCIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/** What the typed price is the price OF. Saved as an hourly rate either way — that is what bills. */
export type PriceUnit = "hour" | "lesson";

const PRICE_UNITS: PriceUnit[] = ["hour", "lesson"];

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c.code, label: c.code, sublabel: c.name }));

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/** The subscription fields as the API returns them — what an edit opens on. */
interface SavedSubscription {
  price_basis: string;
  price_minor: number;
  currency: string;
  sessions_per_month: number | null;
  lesson_minutes?: number | null;
  start_date: string;
}

/**
 * A monthly subscription as form state — shared by the new-student form, the trial→active wizard
 * and the profile's edit modal, which each had their own copy of these fields before.
 *
 * The desk counts lessons of a length ("8 lessons of 40 minutes") and quotes either the hour or
 * the lesson; the hourly rate the engine bills by is worked out from whichever was typed. A free
 * student keeps the count and the length (they still say what the student takes) and has no price.
 */
export function useMonthlyTerms({ defaultCurrency = "" }: { defaultCurrency?: string } = {}) {
  const t = useTranslations("students");
  const [free, setFree] = useState(false);
  const [lessons, setLessons] = useState("");
  const [unitMinutes, setUnitMinutes] = useState(60);
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnitRaw] = useState<PriceUnit>("hour");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split("T")[0] ?? "");

  const lessonCount = lessonCountOf(lessons);
  const priceMinor = Math.round(Number.parseFloat((price || "0").replace(",", ".")) * 100);
  const hourlyMinor = priceUnit === "hour" ? priceMinor : Math.round((priceMinor * 60) / unitMinutes);
  const lessonMinor = priceUnit === "lesson" ? priceMinor : Math.round((priceMinor * unitMinutes) / 60);

  const valid = startDate !== "" && (free || (price.trim() !== "" && priceMinor >= 0));

  /** Switching unit restates the same deal in the new unit — it never quietly changes the price. */
  function setPriceUnit(next: PriceUnit) {
    if (next === priceUnit) return;
    if (price.trim() !== "") setPrice(majorText(next === "hour" ? hourlyMinor : lessonMinor));
    setPriceUnitRaw(next);
  }

  /** Open the fields on a saved subscription. */
  function load(sub: SavedSubscription) {
    setFree(sub.price_basis === "FREE");
    setLessons(sub.sessions_per_month != null ? String(sub.sessions_per_month) : "");
    // Before a length was recorded the count was hours — the same figure in 60-minute lessons.
    setUnitMinutes(sub.lesson_minutes ?? 60);
    setPriceUnitRaw("hour");
    setPrice(sub.price_basis === "FREE" ? "" : (sub.price_minor / 100).toString());
    setCurrency(sub.currency);
    setStartDate(sub.start_date);
  }

  function toPayload(): SubscriptionInput {
    const shape = lessonCount !== null ? t("monthly.planLessons", { lessons: lessonCount, minutes: unitMinutes }) : null;
    const common = {
      sessions_per_month: lessonCount,
      lesson_minutes: unitMinutes,
      currency: currency || undefined,
      start_date: startDate,
    };
    return free
      ? { ...common, plan_label: shape ? t("monthly.planFreeLessons", { shape }) : t("monthly.planFree"), price_minor: 0, price_basis: "FREE" }
      : { ...common, plan_label: shape ?? t("monthly.planHourly"), price_minor: hourlyMinor, price_basis: "PER_HOUR" };
  }

  return {
    free,
    setFree,
    lessons,
    setLessons,
    lessonCount,
    unitMinutes,
    setUnitMinutes,
    price,
    setPrice,
    priceUnit,
    setPriceUnit,
    hourlyMinor,
    lessonMinor,
    currency,
    setCurrency,
    startDate,
    setStartDate,
    valid,
    load,
    toPayload,
  };
}

export type MonthlyTerms = ReturnType<typeof useMonthlyTerms>;

/**
 * The monthly subscription's fields, with the deal read back underneath: the hours the lessons
 * add up to, one lesson's price, the hour's, and roughly what the month comes to.
 */
export function MonthlyTermsFields({ terms, idPrefix }: { terms: MonthlyTerms; idPrefix: string }) {
  const t = useTranslations("students");
  const locale = useLocale();
  const free = terms.free;
  const money = (minor: number) =>
    terms.currency ? formatMoney({ amount: minor, currency: terms.currency }, locale) : majorText(minor);
  const priceLabel =
    terms.priceUnit === "hour" ? t("subscription.priceHourly") : t("monthly.priceLesson", { minutes: terms.unitMinutes });
  const lessonsLine =
    terms.lessonCount !== null
      ? t("monthly.readoutLessons", {
          lessons: terms.lessonCount,
          minutes: terms.unitMinutes,
          hours: formatHours(terms.lessonCount * terms.unitMinutes, locale),
        })
      : null;
  const priced = !free && terms.price.trim() !== "";

  return (
    <div className="space-y-4">
      <label
        className={cn(
          "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors",
          free ? "border-emerald-300 bg-emerald-500/[0.07] dark:border-emerald-800/60" : "border-input hover:bg-muted/30",
        )}
        data-testid={`${idPrefix}-free`}
      >
        <input
          type="checkbox"
          checked={terms.free}
          onChange={(e) => terms.setFree(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="flex items-center gap-1.5 font-medium">
            <Gift className="size-3.5" aria-hidden />
            {t("monthly.free")}
          </span>
          <span className="text-muted-foreground/80 block text-[11px]">{t("monthly.freeHint")}</span>
        </span>
      </label>

      <LessonCountFields
        lessons={terms.lessons}
        onLessons={terms.setLessons}
        unitMinutes={terms.unitMinutes}
        onUnitMinutes={terms.setUnitMinutes}
        lessonsLabel={t("monthly.lessons")}
        idPrefix={idPrefix}
      />

      {!free && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${idPrefix}-price`} className="text-sm font-medium">
                {priceLabel}
              </label>
              {/* The unit the desk quotes in; the other one is read back below. */}
              <div className="bg-muted/60 inline-flex shrink-0 rounded-lg p-0.5" role="group" aria-label={t("monthly.priceUnit")}>
                {PRICE_UNITS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => terms.setPriceUnit(unit)}
                    aria-pressed={terms.priceUnit === unit}
                    data-testid={`${idPrefix}-unit-${unit}`}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                      terms.priceUnit === unit ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`monthly.per.${unit}`)}
                  </button>
                ))}
              </div>
            </div>
            <input
              id={`${idPrefix}-price`}
              type="number"
              min="0"
              step="0.01"
              value={terms.price}
              onChange={(e) => terms.setPrice(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t("subscription.currency")}</span>
            <Combobox
              options={CURRENCY_OPTIONS}
              value={terms.currency}
              onChange={terms.setCurrency}
              placeholder={t("form.currencyPlaceholder")}
              searchPlaceholder={t("form.searchCurrency")}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-start`} className="text-sm font-medium">
            {t("subscription.startDate")}
          </label>
          <input
            id={`${idPrefix}-start`}
            type="date"
            value={terms.startDate}
            onChange={(e) => terms.setStartDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {free ? (
        <p
          className="rounded-xl bg-emerald-500/[0.08] px-3 py-2.5 text-center text-sm text-emerald-800 dark:text-emerald-300"
          data-testid={`${idPrefix}-readout`}
        >
          <span className="block font-semibold">{t("monthly.freeReadout")}</span>
          {lessonsLine && <span className="mt-0.5 block text-xs opacity-80">{lessonsLine}</span>}
        </p>
      ) : (
        priced && (
          <p
            className="bg-primary/[0.07] text-primary rounded-xl px-3 py-2.5 text-center text-sm"
            data-testid={`${idPrefix}-readout`}
          >
            {terms.lessonCount !== null && (
              <span className="block font-semibold">
                {t("monthly.readoutMonth", { total: money(terms.lessonCount * terms.lessonMinor) })}
              </span>
            )}
            <span className="mt-0.5 block text-xs">
              {[
                lessonsLine,
                t("monthly.readoutLesson", { minutes: terms.unitMinutes, price: money(terms.lessonMinor) }),
                t("monthly.readoutHour", { price: money(terms.hourlyMinor) }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="text-primary/70 mt-1 block text-[11px]">{t("monthly.readoutNote")}</span>
          </p>
        )
      )}
    </div>
  );
}
