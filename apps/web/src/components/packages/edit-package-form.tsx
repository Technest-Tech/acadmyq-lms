"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  updateLessonPackage,
  type LessonPackageRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";

const inputBase =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/**
 * Correct a package that was entered wrong — the wrong hours typed, the wrong total agreed, a
 * label nobody recognises, an expiry that should never have been there.
 *
 * Deliberately not the open form with the fields greyed out. Almost nothing about a running
 * package is a correction: the student it belongs to, when it started, whether it bills up front
 * and what carried into it are all facts other records already depend on. What is left is these
 * four, so those are the only ones offered — and the floor under the hours is what has already
 * been taught, because a package cannot be sold backwards.
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

  const [label, setLabel] = useState(row.label);
  const [hours, setHours] = useState((row.minutes_total / 60).toString());
  const [price, setPrice] = useState((row.price_minor / 100).toFixed(2));
  const [expiresOn, setExpiresOn] = useState(row.expires_on ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hoursNum = Number.parseFloat(hours);
  const priceMinor = Math.round(Number.parseFloat(price || "0") * 100);

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
  const tooSmall =
    Number.isFinite(hoursNum) && Math.round(hoursNum * 60) <= minutesFloor;

  const valid =
    label.trim() !== "" &&
    Number.isFinite(hoursNum) &&
    hoursNum >= 0.5 &&
    priceMinor >= 0 &&
    !tooSmall;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateLessonPackage(row.id, {
        label: label.trim(),
        hours: hoursNum,
        price_minor: priceMinor,
        expires_on: expiresOn === "" ? null : expiresOn,
      });
      onSaved(t("alerts.edited"));
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

      {/* What is already spent, stated before the fields that must respect it. */}
      <p className="bg-muted/40 text-muted-foreground rounded-xl px-3 py-2.5 text-xs">
        {t("edit.consumed", {
          used: formatHours(row.minutes_consumed, locale),
          lessons: row.lesson_count,
        })}
      </p>

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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="pkg-edit-hours" className="text-sm font-medium">
            {t("form.hours")}
          </label>
          <input
            id="pkg-edit-hours"
            type="number"
            min="0.5"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={inputBase}
          />
        </div>
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

      {tooSmall && (
        <p className="text-destructive text-xs" data-testid="package-too-small">
          {t("edit.tooSmall", {
            used: formatHours(row.minutes_consumed, locale),
          })}
        </p>
      )}

      {hourlyRate !== null && (
        <p className="text-muted-foreground text-xs">
          {t("form.derivedRate", {
            rate: formatMoney(
              { amount: hourlyRate, currency: row.currency },
              locale,
            ),
          })}
        </p>
      )}

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

      {/* The bill is the hard edge, and it is cheaper to say so here than to be refused on save. */}
      {row.invoice_id !== null && (
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
