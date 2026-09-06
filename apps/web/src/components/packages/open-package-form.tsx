"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { CURRENCIES } from "@/lib/countries";
import {
  ApiError,
  listPackageStudents,
  openLessonPackage,
  type PackageBillTiming,
  type PackageStudent,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const TIMINGS: PackageBillTiming[] = ["ON_START", "ON_COMPLETION"];

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
  value: c.code,
  label: c.code,
  sublabel: c.name,
}));

/**
 * Open a block of hours for a student.
 *
 * The form asks for HOURS because that is the unit an academy sells in; the server turns them
 * into minutes on arrival and nothing downstream sees a fraction again. It also shows the
 * derived hourly rate live, because "20 hours for 4000" and "200 an hour" are the same deal and
 * the owner will be quoting whichever one the parent asked about.
 *
 * Only students whose subscription is on package billing appear here — a student cannot be on
 * the monthly clock and this one at the same time, and the picker is where that is made obvious
 * rather than discovered through a double bill.
 */
export function OpenPackageForm({
  onSaved,
  onCancel,
}: {
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [students, setStudents] = useState<PackageStudent[] | null>(null);
  const [studentId, setStudentId] = useState("");
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState("");
  const [price, setPrice] = useState("");
  const [priceWasEdited, setPriceWasEdited] = useState(false);
  const [currency, setCurrency] = useState("");
  const [timing, setTiming] = useState<PackageBillTiming>("ON_START");
  const [startsOn, setStartsOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [expiresOn, setExpiresOn] = useState("");
  const [carryOver, setCarryOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPackageStudents()
      .then((r) => setStudents(r.students))
      .catch(() => setStudents([]));
  }, []);

  const student = students?.find((s) => s.id === studentId) ?? null;

  const hoursNum = Number.parseFloat(hours);
  const priceMinor = Math.round(Number.parseFloat(price || "0") * 100);

  /** The same deal read the other way round — what one hour of this package costs. */
  const hourlyRate = useMemo(() => {
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) return null;
    return Math.round((priceMinor * 60) / Math.round(hoursNum * 60));
  }, [hoursNum, priceMinor]);

  // Keep the suggested total in step with the package size until the owner deliberately edits
  // it. Checking `price !== ""` is not enough here: typing "16" fires this effect after the first
  // keystroke, so it used to lock in the price for ONE hour (12.50) before the second digit arrived,
  // then display 0.78/hour for a 16-hour package. A manual total still wins from that point on.
  useEffect(() => {
    if (student === null || !Number.isFinite(hoursNum) || hoursNum <= 0) return;
    if (priceWasEdited) return;
    setPrice(((student.default_hourly_rate_minor * hoursNum) / 100).toFixed(2));
  }, [student, hoursNum, priceWasEdited]);

  // The student's agreed currency is the default, not the ceiling: a package can be sold in
  // another one (a family paying in USD for a term abroad), so the field is a real choice rather
  // than a label. Selecting a student seeds it; typing over it wins from then on.
  useEffect(() => {
    if (student !== null) setCurrency(student.currency);
  }, [student]);

  const alreadyOpen = student?.active_package_id != null;
  const valid =
    studentId !== "" &&
    currency !== "" &&
    label.trim() !== "" &&
    Number.isFinite(hoursNum) &&
    hoursNum >= 0.5 &&
    priceMinor >= 0 &&
    !alreadyOpen;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await openLessonPackage({
        student_id: studentId,
        label: label.trim(),
        hours: hoursNum,
        price_minor: priceMinor,
        currency,
        bill_timing: timing,
        starts_on: startsOn,
        expires_on: expiresOn === "" ? null : expiresOn,
        carry_over: carryOver,
      });
      onSaved(
        result.skipped_locked_lessons > 0
          ? t("alerts.openedWithLocked", {
              imported: result.imported_lessons,
              locked: result.skipped_locked_lessons,
            })
          : result.imported_lessons > 0
            ? t("alerts.openedWithLessons", { count: result.imported_lessons })
            : result.invoice_id !== null
              ? t("alerts.openedAndBilled")
              : t("alerts.opened"),
      );
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

      <div className="space-y-1.5">
        <label htmlFor="pkg-student" className="text-sm font-medium">
          {t("form.student")}
        </label>
        <select
          id="pkg-student"
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            setPrice("");
            setPriceWasEdited(false);
          }}
          className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
        >
          <option value="">{t("form.studentPlaceholder")}</option>
          {(students ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
              {s.active_package_id !== null
                ? ` — ${t("form.hasOpenPackage")}`
                : ""}
            </option>
          ))}
        </select>
        {students !== null && students.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {t("form.noEligibleStudents")}
          </p>
        )}
        {alreadyOpen && (
          <p className="text-destructive text-xs">{t("form.alreadyOpen")}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="pkg-label" className="text-sm font-medium">
          {t("form.label")}
        </label>
        <input
          id="pkg-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("form.labelPlaceholder")}
          className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="pkg-hours" className="text-sm font-medium">
            {t("form.hours")}
          </label>
          <input
            id="pkg-hours"
            type="number"
            min="0.5"
            step="0.5"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="20"
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pkg-price" className="text-sm font-medium">
            {t("form.price")}
          </label>
          <input
            id="pkg-price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setPriceWasEdited(true);
            }}
            placeholder="4000"
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
          />
        </div>
      </div>

      {/* The currency the total is agreed in. It defaults to the student's, but it is a field and
          not a caption: the price, the derived hourly rate, the invoice and every later overdraft
          are all snapshotted in THIS currency, and nothing downstream ever converts (§3.6). */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("form.currency")}</span>
        <Combobox
          options={CURRENCY_OPTIONS}
          value={currency}
          onChange={setCurrency}
          placeholder={t("form.currencyPlaceholder")}
          searchPlaceholder={t("form.searchCurrency")}
          data-testid="package-currency"
        />
        {student !== null &&
          currency !== student.currency &&
          currency !== "" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("form.currencyDiffers", { currency: student.currency })}
            </p>
          )}
      </div>

      {hourlyRate !== null && currency !== "" && (
        <p className="text-muted-foreground text-xs">
          {t("form.derivedRate", {
            rate: formatMoney({ amount: hourlyRate, currency }, locale),
          })}
        </p>
      )}

      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("form.timing")}</span>
        <div className="grid grid-cols-2 gap-2">
          {TIMINGS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTiming(option)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-start text-sm font-medium transition-colors",
                timing === option
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
          <label htmlFor="pkg-starts" className="text-sm font-medium">
            {t("form.startsOn")}
          </label>
          <input
            id="pkg-starts"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pkg-expires" className="text-sm font-medium">
            {t("form.expiresOn")}
          </label>
          <input
            id="pkg-expires"
            type="date"
            value={expiresOn}
            min={startsOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
          />
          <p className="text-muted-foreground/80 text-[11px]">
            {t("form.expiresHint")}
          </p>
        </div>
      </div>

      {/* Carry-over is opt-in on purpose: unused hours are the academy's to forgive or keep,
          and moving them silently is how disputes start. */}
      <label className="border-input hover:bg-muted/30 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors">
        <input
          type="checkbox"
          checked={carryOver}
          onChange={(e) => setCarryOver(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="block font-medium">{t("form.carryOver")}</span>
          <span className="text-muted-foreground/80 block text-[11px]">
            {t("form.carryOverHint")}
          </span>
        </span>
      </label>

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
          className="gap-1.5"
        >
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {t("actions.open")}
        </Button>
      </div>
    </div>
  );
}
