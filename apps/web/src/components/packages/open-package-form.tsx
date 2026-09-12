"use client";

import { ChevronDown, Info, Repeat, TriangleAlert } from "lucide-react";
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

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/**
 * Sell a student a block of hours — the whole setup, on one form.
 *
 * This form is the ONLY place a package is created, and that is a deliberate correction. It used
 * to be two screens: an owner first had to open the student's profile and flip their subscription
 * to package billing, because the picker here listed nobody else — so the mandatory first step
 * was invisible from the screen that needed it, and half the terms of a deal were entered in one
 * place and half in another. Now the picker lists every student, saving performs the switch
 * ({@see LessonPackages::ensurePackageBilling} on the server), and the note under the picker says
 * so before the owner commits rather than after.
 *
 * The shape follows the deal, not the schema: WHO, then WHAT THEY BOUGHT, then — folded away —
 * the billing details that have a right answer nine times out of ten. The form asks for HOURS
 * because that is the unit an academy sells in; the server turns them into minutes on arrival and
 * nothing downstream sees a fraction again. It shows the derived hourly rate live, because
 * "20 hours for 4000" and "200 an hour" are the same deal and the owner will be quoting whichever
 * one the parent asked about.
 */
export function OpenPackageForm({
  initialStudentId,
  studentsWithHistory,
  onSaved,
  onCancel,
}: {
  /** Pre-selects a student — set when the form is opened from that student's profile. */
  initialStudentId?: string;
  /** Students who have a closed package to carry hours over FROM. Others never see the option. */
  studentsWithHistory?: ReadonlySet<string>;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [students, setStudents] = useState<PackageStudent[] | null>(null);
  const [studentId, setStudentId] = useState(initialStudentId ?? "");
  const [label, setLabel] = useState("");
  const [labelWasEdited, setLabelWasEdited] = useState(false);
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
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  /** One line per student: which clock they are on today, and what it costs. */
  const studentOptions = useMemo(
    () =>
      (students ?? []).map((s) => ({
        value: s.id,
        label: s.full_name,
        sublabel:
          s.active_package_id !== null
            ? t("form.hasOpenPackage")
            : s.price_basis === null
              ? t("form.modeNone")
              : s.on_package_billing
                ? t("form.modePackage")
                : s.default_hourly_rate_minor > 0
                  ? t("form.modeMonthlyWithRate", {
                      rate: formatMoney(
                        {
                          amount: s.default_hourly_rate_minor,
                          currency: s.currency,
                        },
                        locale,
                      ),
                    })
                  : t("form.modeMonthly"),
      })),
    [students, t, locale],
  );

  // Keep the suggested total in step with the package size until the owner deliberately edits
  // it. Checking `price !== ""` is not enough here: typing "16" fires this effect after the first
  // keystroke, so it used to lock in the price for ONE hour (12.50) before the second digit arrived,
  // then display 0.78/hour for a 16-hour package. A manual total still wins from that point on.
  //
  // A student with no hourly rate on file (no subscription, or a monthly/per-session one, which is
  // a different unit) gets no suggestion at all — a total of 0.00 reads as a real quote.
  useEffect(() => {
    if (student === null || !Number.isFinite(hoursNum) || hoursNum <= 0) return;
    if (priceWasEdited || student.default_hourly_rate_minor <= 0) return;
    setPrice(((student.default_hourly_rate_minor * hoursNum) / 100).toFixed(2));
  }, [student, hoursNum, priceWasEdited]);

  // The name writes itself from the size and the month it starts, which is what an owner types
  // anyway. It stays a real field: the first keystroke in it ends the suggestion for good.
  useEffect(() => {
    if (labelWasEdited || !Number.isFinite(hoursNum) || hoursNum <= 0) return;
    setLabel(
      t("form.labelAuto", {
        hours: hoursNum,
        month: new Date(`${startsOn}T00:00:00`).toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
        }),
      }),
    );
  }, [hoursNum, startsOn, labelWasEdited, locale, t]);

  // The student's agreed currency is the default, not the ceiling: a package can be sold in
  // another one (a family paying in USD for a term abroad), so the field is a real choice rather
  // than a label. Selecting a student seeds it; typing over it wins from then on.
  useEffect(() => {
    if (student !== null) setCurrency(student.currency);
  }, [student]);

  const alreadyOpen = student?.active_package_id != null;
  /** Saving will also move this student onto package billing. Said out loud, before they commit. */
  const willSwitch = student !== null && !student.on_package_billing;
  const canCarryOver =
    student !== null && (studentsWithHistory?.has(student.id) ?? false);

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
        carry_over: canCarryOver && carryOver,
      });

      const opened =
        result.skipped_locked_lessons > 0
          ? t("alerts.openedWithLocked", {
              imported: result.imported_lessons,
              locked: result.skipped_locked_lessons,
            })
          : result.imported_lessons > 0
            ? t("alerts.openedWithLessons", { count: result.imported_lessons })
            : result.invoice_id !== null
              ? t("alerts.openedAndBilled")
              : t("alerts.opened");

      // The mode change is reported by the server, not assumed from the form: a second tab could
      // have moved this student already, and claiming a switch that did not happen is worse than
      // staying quiet about one that did.
      onSaved(
        result.switched_to_package_billing
          ? `${opened} ${t("alerts.switchedToPackages", { name: student?.full_name ?? "" })}`
          : opened,
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

      {/* ── 1. Who ──────────────────────────────────────────────────────
          Every active student, not only those already on package billing: the switch happens on
          save, so there is nothing to prepare elsewhere first. */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("form.student")}</span>
        <Combobox
          options={studentOptions}
          value={studentId}
          onChange={(id) => {
            setStudentId(id);
            setPrice("");
            setPriceWasEdited(false);
            setCarryOver(false);
          }}
          placeholder={t("form.studentPlaceholder")}
          searchPlaceholder={t("form.searchStudent")}
          data-testid="package-student"
        />
        {students !== null && students.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {t("form.noStudents")}
          </p>
        )}
      </div>

      {alreadyOpen && (
        <p
          className="bg-destructive/8 text-destructive flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-medium"
          data-testid="package-already-open"
        >
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {t("form.alreadyOpen")}
        </p>
      )}

      {willSwitch && !alreadyOpen && (
        <p
          className="flex items-start gap-2 rounded-xl border border-sky-300/60 bg-sky-500/[0.07] px-3 py-2.5 text-xs text-sky-800 dark:border-sky-800/50 dark:text-sky-300"
          data-testid="package-switch-note"
        >
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="block font-semibold">
              {t("form.switchTitle", { name: student.full_name })}
            </span>
            <span className="block opacity-90">{t("form.switchHint")}</span>
          </span>
        </p>
      )}

      {/* ── 2. What they bought ─────────────────────────────────────── */}
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
            className={inputClass}
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
            className={inputClass}
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

      {/* The deal read back, in the unit the parent will quote at you. */}
      {hourlyRate !== null && currency !== "" && (
        <p
          className="bg-primary/[0.07] text-primary rounded-xl px-3 py-2.5 text-center text-sm font-semibold"
          data-testid="package-rate-readout"
        >
          {t("form.derivedRate", {
            rate: formatMoney({ amount: hourlyRate, currency }, locale),
          })}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="pkg-label" className="text-sm font-medium">
          {t("form.label")}
        </label>
        <input
          id="pkg-label"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setLabelWasEdited(true);
          }}
          placeholder={t("form.labelPlaceholder")}
          className={inputClass}
        />
      </div>

      {/* ── 3. The details with a right answer ──────────────────────────
          Folded away rather than dropped: bill on start, from today, no expiry is the deal nine
          times out of ten, and a form that asks four questions nobody has an opinion about is
          how this ended up feeling complicated. */}
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
                timing: t(`timing.${timing}`),
                starts: startsOn,
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
                  className={inputClass}
                />
                <p className="text-muted-foreground/80 text-[11px]">
                  {t("form.startsHint")}
                </p>
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
                  className={inputClass}
                />
                <p className="text-muted-foreground/80 text-[11px]">
                  {t("form.expiresHint")}
                </p>
              </div>
            </div>

            {/* Carry-over is opt-in on purpose: unused minutes are the academy's to forgive or
                keep, and moving them silently is how disputes start. It only appears for a
                student who HAS a closed package to move hours from — an option that cannot do
                anything is one more thing to wonder about. */}
            {canCarryOver && (
              <label className="border-input hover:bg-muted/30 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors">
                <input
                  type="checkbox"
                  checked={carryOver}
                  onChange={(e) => setCarryOver(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Repeat className="size-3.5" aria-hidden />
                    {t("form.carryOver")}
                  </span>
                  <span className="text-muted-foreground/80 block text-[11px]">
                    {t("form.carryOverHint")}
                  </span>
                </span>
              </label>
            )}
          </div>
        )}
      </div>

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
