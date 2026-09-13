"use client";

import { Info, Repeat, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  PackageTermsFields,
  usePackageTerms,
} from "@/components/packages/package-terms";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  ApiError,
  listPackageStudents,
  openLessonPackage,
  type PackageStudent,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";

/**
 * Sell an existing student a block of hours.
 *
 * Opening a package also puts the student on package billing
 * ({@see LessonPackages::ensurePackageBilling} on the server), so the picker lists every student
 * and the note under it says so before the owner commits rather than after. It used to need a
 * trip to the student's profile first, to flip a toggle this screen could not see.
 *
 * The package fields themselves are {@link PackageTermsFields} — the same ones the new-student
 * form and the trial→active wizard show — so "what a package needs" is defined exactly once. What
 * is particular to THIS screen is choosing an existing student, the warnings that only make sense
 * for one, and carry-over, which needs an earlier package to carry hours from.
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
  const [carryOver, setCarryOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPackageStudents()
      .then((r) => setStudents(r.students))
      .catch(() => setStudents([]));
  }, []);

  const student = students?.find((s) => s.id === studentId) ?? null;

  const terms = usePackageTerms({
    defaultHourlyRateMinor: student?.default_hourly_rate_minor ?? 0,
    defaultCurrency: student?.currency ?? "",
    resetKey: studentId,
  });

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

  const alreadyOpen = student?.active_package_id != null;
  /** Saving will also move this student onto package billing. Said out loud, before they commit. */
  const willSwitch = student !== null && !student.on_package_billing;
  const canCarryOver =
    student !== null && (studentsWithHistory?.has(student.id) ?? false);

  const valid = studentId !== "" && terms.valid && !alreadyOpen;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await openLessonPackage({
        student_id: studentId,
        ...terms.toPayload(),
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

      {/* ── Who ─────────────────────────────────────────────────────────
          Every active student, not only those already on package billing: the switch happens on
          save, so there is nothing to prepare elsewhere first. */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("form.student")}</span>
        <Combobox
          options={studentOptions}
          value={studentId}
          onChange={(id) => {
            setStudentId(id);
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

      {/* ── What they bought ────────────────────────────────────────── */}
      <PackageTermsFields
        terms={terms}
        agreedCurrency={student?.currency}
        advancedExtra={
          // Carry-over is opt-in on purpose: unused minutes are the academy's to forgive or keep,
          // and moving them silently is how disputes start. It only appears for a student who HAS
          // a closed package to move hours from — an option that cannot do anything is one more
          // thing to wonder about.
          canCarryOver ? (
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
          ) : null
        }
      />

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
