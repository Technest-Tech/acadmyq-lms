"use client";

import {
  Banknote,
  CalendarDays,
  Check,
  Clock,
  Hash,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  countPastLessons,
  StartDateField,
  todayLocal,
} from "@/components/scheduling/start-date-field";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  ApiError,
  listTeachers,
  putStudentSchedule,
  reassignTeacher,
  setSubscription,
  updateStudent,
  type ScheduleSlot,
  type TeacherRow,
} from "@/lib/api";
import { CURRENCIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

// ── Shared ─────────────────────────────────────────────────────────────────────

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ms-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function toMinor(val: string): number {
  return Math.round(parseFloat(val || "0") * 100);
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="flex items-center justify-center mb-6">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "flex size-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-200",
                i < current
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                  : i === current
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/15 shadow-md shadow-primary/30"
                    : "border border-border bg-muted text-muted-foreground",
              )}
            >
              {i < current ? <Check className="size-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap",
                i === current ? "text-primary" : "text-muted-foreground/50",
              )}
            >
              {label}
            </span>
          </div>
          {i < labels.length - 1 && (
            <div
              className={cn(
                "mx-2 mb-5 h-px w-20 transition-all duration-300",
                i < current ? "bg-primary" : "bg-border",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EnrollmentWizard({
  studentId,
  currentTeacherId,
  onCompleted,
  onCancel,
}: {
  studentId: string;
  currentTeacherId?: string;
  onCompleted: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("students");
  const tSched = useTranslations("scheduling");
  const { can } = useAuth();
  // Whether this user may name a price at all. Drives the whole shape of the wizard below.
  const canPrice = can("student.set_price");
  const [step, setStep] = useState(0);
  // The timetable's own start date. It lives on THIS step because the schedule is saved before
  // the pricing step below — by the time the enrolment start date is typed there, the lessons
  // have already been generated.
  const [scheduleStart, setScheduleStart] = useState<string>(() => todayLocal());
  const [confirmingBackfill, setConfirmingBackfill] = useState(false);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Schedule step
  const [teacherId, setTeacherId] = useState(currentTeacherId ?? "");
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  // Pricing step — always hourly, matching the student-detail subscription form.
  const [sessions, setSessions] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().split("T")[0] ?? "",
  );

  const subCurrencyOptions = useMemo(
    () => [
      { value: "", label: t("form.none"), sublabel: "—" },
      ...CURRENCIES.map((c) => ({ value: c.code, label: c.code, sublabel: c.name })),
    ],
    [t],
  );

  useEffect(() => {
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => {});
  }, []);

  function updateSlot(i: number, patch: Partial<ScheduleSlot>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  const pastLessons = countPastLessons(slots, scheduleStart);

  async function saveSchedule() {
    if (pastLessons > 0 && !confirmingBackfill) {
      setConfirmingBackfill(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (teacherId && teacherId !== currentTeacherId) {
        await reassignTeacher(studentId, { teacher_id: teacherId });
      }
      if (slots.length > 0) {
        await putStudentSchedule(studentId, {
          timezone: timezone || undefined,
          start_date: scheduleStart || undefined,
          slots: slots.map((s) => ({
            weekday: s.weekday,
            start_time_local: s.start_time_local,
            duration_minutes: s.duration_minutes,
          })),
        });
      }
      // Without pricing rights there is no second step to advance to — the schedule IS the job.
      if (canPrice) setStep(1);
      else onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function complete(withPricing: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (withPricing && price && startDate) {
        await setSubscription(studentId, {
          // The package is always hourly now; derive a display label from the quota.
          plan_label: sessions ? `${sessions} hrs/month` : "Hourly",
          sessions_per_month: sessions ? Number(sessions) : null,
          price_minor: toMinor(price),
          currency: currency || undefined,
          price_basis: "PER_HOUR",
          start_date: startDate,
        });
        // REGULAR is the billable state, so it is only reachable once an active subscription
        // exists (the API enforces this). Skipping pricing leaves the student in their current
        // trial status — re-open the wizard with pricing to enrol them as a regular learner.
        await updateStudent(studentId, { status: "REGULAR" });
      }
      onCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const hasPricing = Boolean(price && startDate);

  // ── Step 1: Schedule & Teacher ─────────────────────────────────────────────
  const scheduleStep = (
    <div className="space-y-5">
      <Field label={t("enroll.assignTeacher")}>
        <Combobox
          options={teachers.map((tch) => ({ value: tch.id, label: tch.full_name }))}
          value={teacherId}
          onChange={setTeacherId}
          placeholder={t("enroll.selectTeacher")}
          searchPlaceholder={t("form.searchTeacher")}
        />
      </Field>

      {/* When the lessons start. Sits with the timetable, not with the price, because the
          timetable is saved on THIS step — a start date typed later cannot reach it. */}
      <StartDateField
        className="sm:max-w-xs"
        value={scheduleStart}
        onChange={(v) => {
          setScheduleStart(v);
          setConfirmingBackfill(false);
        }}
        slots={slots}
        disabled={busy}
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{t("form.weeklySchedule")}</label>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              setSlots((prev) => [
                ...prev,
                { weekday: 1, start_time_local: "17:00", duration_minutes: 60 },
              ])
            }
          >
            <Plus className="size-3" />
            {t("form.addSlot")}
          </Button>
        </div>

        {slots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center">
            <Clock className="size-5 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("form.noSlots")}</p>
            <p className="text-xs text-muted-foreground/60">
              {t("form.noSlotsHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {slots.map((slot, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-xl border bg-muted/20 px-3 py-2.5"
              >
                <select
                  value={slot.weekday}
                  onChange={(e) => updateSlot(i, { weekday: Number(e.target.value) })}
                  className="h-7 rounded-lg border bg-background px-2 text-xs font-medium focus:outline-none"
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((di) => (
                    <option key={di} value={di}>
                      {tSched(`weekday.${di}`)}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={slot.start_time_local}
                  onChange={(e) => updateSlot(i, { start_time_local: e.target.value })}
                  className="h-7 rounded-lg border bg-background px-2 text-xs focus:outline-none"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={slot.duration_minutes}
                    onChange={(e) =>
                      updateSlot(i, { duration_minutes: Number(e.target.value) })
                    }
                    className="h-7 w-16 rounded-lg border bg-background px-2 text-center text-xs focus:outline-none"
                  />
                  <span className="text-xs text-muted-foreground">{t("form.minutesShort")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                  className="ms-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}

            <Field label={t("form.timezone")}>
              <input
                className={cn(inputBase, "px-3.5 py-2.5")}
                placeholder={t("form.timezonePlaceholder")}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );

  // ── Step 2: Subscription & Pricing ────────────────────────────────────────
  const pricingStep = (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-950/20">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-xs text-emerald-800 dark:text-emerald-300">
          {t("enroll.pricingHint")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("subscription.priceHourly")}>
          <div className="relative">
            <Banknote className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="number"
              step="0.01"
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </Field>

        <Field label={t("subscription.hoursPerMonth")}>
          <div className="relative">
            <Hash className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="number"
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
              placeholder="8"
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
            />
          </div>
        </Field>

        <Field label={t("subscription.currency")}>
          <Combobox
            options={subCurrencyOptions}
            value={currency}
            onChange={setCurrency}
            placeholder={t("form.currencyPlaceholder")}
            searchPlaceholder={t("form.searchCurrency")}
          />
        </Field>

        <Field label={t("subscription.startDate")}>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="date"
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
        </Field>
      </div>
    </div>
  );

  return (
    <div className="space-y-0">
      {/* Pricing is a step only for whoever may price. For a role without `student.set_price`
          (SUPERVISOR) the wizard is schedule-and-teacher and then done — offering the step and
          failing on save would be worse than not offering it. */}
      {canPrice && (
        <StepIndicator
          current={step}
          labels={[t("enroll.stepSchedule"), t("enroll.stepPricing")]}
        />
      )}

      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="min-h-0">
        {step === 0 ? scheduleStep : pricingStep}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
        {step === 0 ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={busy}
            >
              {t("actions.cancel")}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => (canPrice ? setStep(1) : onCompleted())}
                disabled={busy}
              >
                {canPrice ? t("enroll.skipSchedule") : t("actions.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveSchedule()}
                disabled={busy}
                className="gap-1.5"
              >
                {busy ? (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {confirmingBackfill
                  ? tSched("startDateBackfillConfirm", { count: pastLessons })
                  : t("enroll.saveContinue")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep(0)}
              disabled={busy}
            >
              {t("back")}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void complete(false)}
                disabled={busy}
              >
                {busy ? (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                ) : null}
                {t("enroll.skipConfirm")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void complete(true)}
                disabled={busy || !hasPricing}
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 border-transparent focus-visible:ring-emerald-500/40"
              >
                {busy ? (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {t("enroll.title")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
