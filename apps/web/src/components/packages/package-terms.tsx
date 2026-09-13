"use client";

import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Combobox } from "@/components/ui/combobox";
import type { PackageBillTiming } from "@/lib/api";
import { CURRENCIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const TIMINGS: PackageBillTiming[] = ["ON_START", "ON_COMPLETION"];

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
  value: c.code,
  label: c.code,
  sublabel: c.name,
}));

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/** What the API takes for a package, whichever screen collected it. */
export interface PackageTermsPayload {
  label: string;
  hours: number;
  price_minor: number;
  currency: string;
  bill_timing: PackageBillTiming;
  starts_on: string;
  expires_on: string | null;
}

/**
 * The terms of one block of hours, as form state — shared by every screen that sells one.
 *
 * There are three: the packages screen, the new-student form, and the trial→active wizard. They
 * used to be one form and two hardcoded "monthly" price boxes, which is how a package came to be
 * set up from several places with different fields in each. This hook is the single definition
 * of what a package needs and how its suggestions behave, so the three can never drift apart.
 *
 * `defaultHourlyRateMinor` pre-fills the total from a rate already agreed with the family (zero
 * means none is on file, and no total is suggested — 0.00 reads as a real quote).
 * `defaultCurrency` seeds the currency whenever it changes; `resetKey` (a student id) clears the
 * owner's manual total when the form is pointed at somebody else.
 */
export function usePackageTerms({
  defaultHourlyRateMinor = 0,
  defaultCurrency = "",
  resetKey = "",
}: {
  defaultHourlyRateMinor?: number;
  defaultCurrency?: string;
  resetKey?: string;
} = {}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [hours, setHours] = useState("");
  const [price, setPriceRaw] = useState("");
  const [priceWasEdited, setPriceWasEdited] = useState(false);
  const [label, setLabelRaw] = useState("");
  const [labelWasEdited, setLabelWasEdited] = useState(false);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [timing, setTiming] = useState<PackageBillTiming>("ON_START");
  const [startsOn, setStartsOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [expiresOn, setExpiresOn] = useState("");

  const hoursNum = Number.parseFloat(hours);
  const priceMinor = Math.round(Number.parseFloat(price || "0") * 100);

  /** The same deal read the other way round — what one hour of this package costs. */
  const hourlyRate = useMemo(() => {
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) return null;
    return Math.round((priceMinor * 60) / Math.round(hoursNum * 60));
  }, [hoursNum, priceMinor]);

  // Pointing the form at another student forgets the total typed for the last one.
  useEffect(() => {
    setPriceRaw("");
    setPriceWasEdited(false);
  }, [resetKey]);

  // The agreed currency is the default, not the ceiling: a package can be sold in another one (a
  // family paying in USD for a term abroad), so it seeds the field rather than fixing it.
  useEffect(() => {
    if (defaultCurrency !== "") setCurrency(defaultCurrency);
  }, [defaultCurrency, resetKey]);

  // Keep the suggested total in step with the package size until the owner deliberately edits
  // it. Checking `price !== ""` is not enough here: typing "16" fires this effect after the first
  // keystroke, so it used to lock in the price for ONE hour (12.50) before the second digit arrived,
  // then display 0.78/hour for a 16-hour package. A manual total still wins from that point on.
  useEffect(() => {
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) return;
    if (priceWasEdited || defaultHourlyRateMinor <= 0) return;
    setPriceRaw(((defaultHourlyRateMinor * hoursNum) / 100).toFixed(2));
  }, [hoursNum, priceWasEdited, defaultHourlyRateMinor, resetKey]);

  // The name writes itself from the size and the month it starts, which is what an owner types
  // anyway. It stays a real field: the first keystroke in it ends the suggestion for good.
  useEffect(() => {
    if (labelWasEdited || !Number.isFinite(hoursNum) || hoursNum <= 0) return;
    setLabelRaw(
      t("form.labelAuto", {
        hours: hoursNum,
        month: new Date(`${startsOn}T00:00:00`).toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
        }),
      }),
    );
  }, [hoursNum, startsOn, labelWasEdited, locale, t]);

  const valid =
    currency !== "" &&
    label.trim() !== "" &&
    Number.isFinite(hoursNum) &&
    hoursNum >= 0.5 &&
    priceMinor >= 0;

  function toPayload(): PackageTermsPayload {
    return {
      label: label.trim(),
      hours: hoursNum,
      price_minor: priceMinor,
      currency,
      bill_timing: timing,
      starts_on: startsOn,
      expires_on: expiresOn === "" ? null : expiresOn,
    };
  }

  return {
    hours,
    setHours,
    price,
    setPrice: (value: string) => {
      setPriceRaw(value);
      setPriceWasEdited(true);
    },
    label,
    setLabel: (value: string) => {
      setLabelRaw(value);
      setLabelWasEdited(true);
    },
    currency,
    setCurrency,
    timing,
    setTiming,
    startsOn,
    setStartsOn,
    expiresOn,
    setExpiresOn,
    hourlyRate,
    valid,
    toPayload,
  };
}

export type PackageTerms = ReturnType<typeof usePackageTerms>;

/**
 * The fields for one block of hours: WHAT THEY BOUGHT up front, then — folded away — the billing
 * details that have a right answer nine times out of ten.
 *
 * `agreedCurrency` turns on the "not the student's currency" warning (only meaningful for a
 * student who already has one). `advancedExtra` renders inside the fold, for options that only
 * some screens have — carry-over needs an earlier package, which a brand-new student never has.
 */
export function PackageTermsFields({
  terms,
  agreedCurrency,
  advancedExtra,
  idPrefix = "pkg",
}: {
  terms: PackageTerms;
  agreedCurrency?: string;
  advancedExtra?: ReactNode;
  idPrefix?: string;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-hours`} className="text-sm font-medium">
            {t("form.hours")}
          </label>
          <input
            id={`${idPrefix}-hours`}
            type="number"
            min="0.5"
            step="0.5"
            value={terms.hours}
            onChange={(e) => terms.setHours(e.target.value)}
            placeholder="20"
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-price`} className="text-sm font-medium">
            {t("form.price")}
          </label>
          <input
            id={`${idPrefix}-price`}
            type="number"
            min="0"
            step="0.01"
            value={terms.price}
            onChange={(e) => terms.setPrice(e.target.value)}
            placeholder="4000"
            className={inputClass}
          />
        </div>
      </div>

      {/* The currency the total is agreed in. It is a field and not a caption: the price, the
          derived hourly rate, the invoice and every later overdraft are all snapshotted in THIS
          currency, and nothing downstream ever converts (§3.6). */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("form.currency")}</span>
        <Combobox
          options={CURRENCY_OPTIONS}
          value={terms.currency}
          onChange={terms.setCurrency}
          placeholder={t("form.currencyPlaceholder")}
          searchPlaceholder={t("form.searchCurrency")}
          data-testid="package-currency"
        />
        {agreedCurrency !== undefined &&
          agreedCurrency !== "" &&
          terms.currency !== "" &&
          terms.currency !== agreedCurrency && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("form.currencyDiffers", { currency: agreedCurrency })}
            </p>
          )}
      </div>

      {/* The deal read back, in the unit the parent will quote at you. */}
      {terms.hourlyRate !== null && terms.currency !== "" && (
        <p
          className="bg-primary/[0.07] text-primary rounded-xl px-3 py-2.5 text-center text-sm font-semibold"
          data-testid="package-rate-readout"
        >
          {t("form.derivedRate", {
            rate: formatMoney(
              { amount: terms.hourlyRate, currency: terms.currency },
              locale,
            ),
          })}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-label`} className="text-sm font-medium">
          {t("form.label")}
        </label>
        <input
          id={`${idPrefix}-label`}
          value={terms.label}
          onChange={(e) => terms.setLabel(e.target.value)}
          placeholder={t("form.labelPlaceholder")}
          className={inputClass}
        />
      </div>

      {/* Folded away rather than dropped: bill on start, from today, no expiry is the deal nine
          times out of ten, and a form that asks questions nobody has an opinion about is how this
          ended up feeling complicated. The summary line shows the defaults, so skipping it is an
          informed choice. */}
      <div className="rounded-xl border">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          data-testid="package-advanced-toggle"
          className="hover:bg-muted/30 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-start transition-colors"
        >
          <span>
            <span className="block text-sm font-medium">
              {t("form.advanced")}
            </span>
            <span className="text-muted-foreground/80 block text-[11px]">
              {t("form.advancedHint", {
                timing: t(`timing.${terms.timing}`),
                starts: terms.startsOn,
              })}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform",
              showAdvanced && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {showAdvanced && (
          <div className="space-y-4 border-t p-3">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t("form.timing")}</span>
              <div className="grid grid-cols-2 gap-2">
                {TIMINGS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => terms.setTiming(option)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-start text-sm font-medium transition-colors",
                      terms.timing === option
                        ? "border-primary/40 bg-primary/8 text-primary"
                        : "border-input bg-background text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    <span className="block">{t(`timing.${option}`)}</span>
                    <span className="text-muted-foreground/80 mt-0.5 block text-[11px] font-normal">
                      {t(`timingHint.${option}`)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor={`${idPrefix}-starts`}
                  className="text-sm font-medium"
                >
                  {t("form.startsOn")}
                </label>
                <input
                  id={`${idPrefix}-starts`}
                  type="date"
                  value={terms.startsOn}
                  onChange={(e) => terms.setStartsOn(e.target.value)}
                  className={inputClass}
                />
                <p className="text-muted-foreground/80 text-[11px]">
                  {t("form.startsHint")}
                </p>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor={`${idPrefix}-expires`}
                  className="text-sm font-medium"
                >
                  {t("form.expiresOn")}
                </label>
                <input
                  id={`${idPrefix}-expires`}
                  type="date"
                  value={terms.expiresOn}
                  min={terms.startsOn}
                  onChange={(e) => terms.setExpiresOn(e.target.value)}
                  className={inputClass}
                />
                <p className="text-muted-foreground/80 text-[11px]">
                  {t("form.expiresHint")}
                </p>
              </div>
            </div>

            {advancedExtra}
          </div>
        )}
      </div>
    </div>
  );
}
