"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { nextTermsText } from "@/components/packages/package-card";
import { LessonCountFields, lessonCountOf } from "@/components/packages/lesson-count-fields";
import {
  LESSON_LENGTHS,
  LessonPriceFields,
  lessonPriceFromTotal,
  majorText,
  totalFromLessonPrice,
} from "@/components/packages/lesson-price-fields";
import { AutoRenewField } from "@/components/packages/package-terms";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  updateLessonPackage,
  type LessonPackageRow,
} from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Where new terms land: this block (and so, through the renewal, the next ones) or the next renewal only. */
type AppliesTo = "CURRENT" | "NEXT";

/**
 * The lessons-of-a-length a saved block was sold as. The size is stored in minutes only, so it is
 * read back from the auto-written label ("8 × 40 min — …") when that still adds up, else from the
 * first usual length that divides it into whole lessons.
 */
function lessonShapeOf(row: LessonPackageRow): { lessons: number; minutes: number } {
  const total = row.minutes_total;
  const digits = row.label.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m = digits.match(/(\d+)\s*×\s*(\d+)/);
  if (m) {
    const lessons = Number(m[1]);
    const minutes = Number(m[2]);
    if (lessons * minutes === total) return { lessons, minutes };
  }
  // The order the desk quotes them in, then the rarer lengths.
  const minutes = [...LESSON_LENGTHS, 50, 25, 20].find((u) => total % u === 0);
  return minutes !== undefined ? { lessons: total / minutes, minutes } : { lessons: 1, minutes: total };
}

const inputBase =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/**
 * Correct a package that was entered wrong — the wrong hours typed, the wrong total agreed, a
 * label nobody recognises, an expiry that should never have been there.
 *
 * Deliberately not the open form with the fields greyed out. Almost nothing about a running
 * package is a correction: the student it belongs to, when it started, whether it bills up front
 * and what carried into it are all facts other records already depend on. What is left is these
 * four — plus whether it renews itself — so those are the only ones offered — and the floor under the hours is what has already
 * been taught, because a package cannot be sold backwards. The size and price are asked in the
 * open form's own fields (lessons × length + total, or a centre's hours + lesson price), so a
 * package reads back the way it was sold.
 */
export function EditPackageForm({
  row,
  onSaved,
  onCancel,
}: {
  row: LessonPackageRow;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();

  // The same fields the package was opened with: a centre quotes hours + one lesson's price,
  // everyone else counts lessons of a length against a total.
  const perLesson = useCapability("centre");
  const [shape] = useState(() => lessonShapeOf(row));
  const [label, setLabel] = useState(row.label);
  const [unitMinutes, setUnitMinutes] = useState(shape.minutes);
  const [lessons, setLessons] = useState(String(shape.lessons));
  // Two decimals are exact enough to land back on the same minute (8 × 40 min reads 5.33).
  const [hours, setHours] = useState(String(Math.round((row.minutes_total / 60) * 100) / 100));
  const [price, setPrice] = useState((row.price_minor / 100).toFixed(2));
  const [unitPrice, setUnitPrice] = useState(() =>
    majorText(lessonPriceFromTotal(row.price_minor, row.minutes_total, shape.minutes)),
  );
  const [expiresOn, setExpiresOn] = useState(row.expires_on ?? "");
  const [autoRenew, setAutoRenew] = useState(row.auto_renew);
  // Asked, never assumed, whenever the terms move on a block that renews itself.
  const [appliesTo, setAppliesTo] = useState<AppliesTo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lessonCount = lessonCountOf(lessons);
  const hoursNum = perLesson
    ? Number.parseFloat(hours)
    : lessonCount !== null
      ? (lessonCount * unitMinutes) / 60
      : Number.NaN;
  const totalMinutes = Number.isFinite(hoursNum) && hoursNum > 0 ? Math.round(hoursNum * 60) : 0;
  const priceMinor = perLesson
    ? totalFromLessonPrice(Math.round(Number.parseFloat((unitPrice || "0").replace(",", ".")) * 100), totalMinutes, unitMinutes)
    : Math.round(Number.parseFloat(price || "0") * 100);

  /** The same deal read the other way round — what one hour of this package costs. */
  const hourlyRate = useMemo(() => {
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) return null;
    return Math.round((priceMinor * 60) / Math.round(hoursNum * 60));
  }, [hoursNum, priceMinor]);

  // A package may not shrink to (or below) what has already been taught: that would leave it
  // open with no balance, which is not a state the engine ever produces. Closing is the
  // operation for "it ends here" — the API says the same thing, this just says it sooner.
  const minutesFloor = Math.max(
    0,
    row.minutes_consumed - row.carried_over_minutes,
  );
  const termsChanged =
    label.trim() !== row.label ||
    (Number.isFinite(hoursNum) && Math.round(hoursNum * 60) !== row.minutes_total) ||
    priceMinor !== row.price_minor;
  // The question only exists when there IS a next block: one that renews itself.
  const askScope = termsChanged && autoRenew;
  const nextOnly = askScope && appliesTo === "NEXT";
  // The floor is about THIS block — new terms for the next one start from zero.
  const tooSmall =
    !nextOnly && Number.isFinite(hoursNum) && Math.round(hoursNum * 60) <= minutesFloor;

  const valid =
    label.trim() !== "" &&
    Number.isFinite(hoursNum) &&
    hoursNum >= 0.5 &&
    priceMinor >= 0 &&
    !tooSmall &&
    (!askScope || appliesTo !== null);
  const parked = nextTermsText(row, locale);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateLessonPackage(row.id, {
        label: label.trim(),
        hours: hoursNum,
        price_minor: priceMinor,
        expires_on: expiresOn === "" ? null : expiresOn,
        auto_renew: autoRenew,
        ...(askScope && appliesTo !== null ? { applies_to: appliesTo } : {}),
      });
      onSaved(nextOnly ? t("alerts.nextTermsSaved") : t("alerts.edited"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      {/* Terms already waiting for the next block, so a second edit starts from what is known. */}
      {parked !== null && (
        <p className="rounded-xl bg-sky-500/10 px-3 py-2.5 text-xs font-medium text-sky-700 dark:text-sky-300" data-testid="edit-parked-terms">
          {t("card.nextTerms", { terms: parked })}
        </p>
      )}

      {/* What is already spent, stated before the fields that must respect it. */}
      <p className="bg-muted/40 text-muted-foreground rounded-xl px-3 py-2.5 text-xs">
        {t("edit.consumed", {
          used: formatHours(row.minutes_consumed, locale),
          lessons: row.lesson_count,
        })}
      </p>

      {!perLesson && (
        <LessonCountFields
          lessons={lessons}
          onLessons={setLessons}
          unitMinutes={unitMinutes}
          onUnitMinutes={setUnitMinutes}
          lessonsLabel={t("form.lessons")}
          idPrefix="pkg-edit-count"
        />
      )}

      {perLesson ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="pkg-edit-hours" className="text-sm font-medium">
              {t("form.hours")}
            </label>
            <input
              id="pkg-edit-hours"
              type="number"
              min="0.5"
              step="any"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className={inputBase}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="pkg-edit-price" className="text-sm font-medium">
              {t("form.price")}
            </label>
            <input
              id="pkg-edit-price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputBase}
            />
          </div>
        </div>
      )}

      {perLesson && (
        <LessonPriceFields
          unitMinutes={unitMinutes}
          onUnitMinutes={setUnitMinutes}
          unitPrice={unitPrice}
          onUnitPrice={setUnitPrice}
          totalMinutes={totalMinutes}
          currency={row.currency}
          idPrefix="pkg-edit-lesson"
        />
      )}

      {tooSmall && (
        <p className="text-destructive text-xs" data-testid="package-too-small">
          {t("edit.tooSmall", {
            used: formatHours(row.minutes_consumed, locale),
          })}
        </p>
      )}

      {/* The deal read back the way the open form reads it: the hours, one lesson's price, the hour's. */}
      {!perLesson && hourlyRate !== null && lessonCount !== null && (
        <p
          className="bg-primary/[0.07] text-primary rounded-xl px-3 py-2.5 text-center text-sm font-semibold"
          data-testid="package-rate-readout"
        >
          {t("form.lessonsReadout", {
            lessons: lessonCount,
            minutes: unitMinutes,
            hours: formatHours(totalMinutes, locale),
            lesson: formatMoney({ amount: Math.round(priceMinor / lessonCount), currency: row.currency }, locale),
            hour: formatMoney({ amount: hourlyRate, currency: row.currency }, locale),
          })}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="pkg-edit-label" className="text-sm font-medium">
          {t("form.label")}
        </label>
        <input
          id="pkg-edit-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("form.labelPlaceholder")}
          className={inputBase}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="pkg-edit-expires" className="text-sm font-medium">
          {t("form.expiresOn")}
        </label>
        <input
          id="pkg-edit-expires"
          type="date"
          value={expiresOn}
          min={row.starts_on}
          onChange={(e) => setExpiresOn(e.target.value)}
          className={inputBase}
        />
        <p className="text-muted-foreground/80 text-[11px]">
          {t("form.expiresHint")}
        </p>
      </div>

      {/* Turning it off is how a family that is stopping does not get a next block opened. */}
      <AutoRenewField checked={autoRenew} onChange={setAutoRenew} />

      {/* New terms on a block that renews: this one too, or only from the next renewal? */}
      {askScope && (
        <fieldset className="space-y-2" data-testid="edit-applies-to">
          <legend className="mb-1 text-sm font-medium">{t("edit.appliesTo.question")}</legend>
          {(["CURRENT", "NEXT"] as const).map((option) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
                appliesTo === option ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                name="pkg-applies-to"
                value={option}
                checked={appliesTo === option}
                onChange={() => setAppliesTo(option)}
                className="accent-primary mt-0.5"
                data-testid={`edit-applies-${option.toLowerCase()}`}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t(`edit.appliesTo.${option}.title`)}</span>
                <span className="text-muted-foreground block text-xs">
                  {t(`edit.appliesTo.${option}.body`, { n: row.sequence_no, next: row.sequence_no + 1 })}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {/* The bill is the hard edge, and it is cheaper to say so here than to be refused on save. */}
      {row.invoice_id !== null && !nextOnly && (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {t("edit.billNote")}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          {t("actions.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={busy || !valid}
          data-testid="save-package-edit"
          className="gap-1.5"
        >
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {t("actions.saveEdit")}
        </Button>
      </div>
    </div>
  );
}
