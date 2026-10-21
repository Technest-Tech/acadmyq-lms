"use client";

import { CalendarDays, Clock, Coins, GraduationCap, Link2, MapPin, Plus, Trash2, Users, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { fieldClass, hoursText, sortSlots, textareaClass, todayIn } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ApiError, listSpecializations, listTeachers, type Specialization } from "@/lib/api";
import { CURRENCIES } from "@/lib/countries";
import {
  createGroup,
  updateGroup,
  type GroupDetail,
  type GroupBillingMode,
  type GroupInput,
  type GroupMode,
  type GroupSlot,
  type GroupTeacherPayMode,
} from "@/lib/groups-api";
import { cn } from "@/lib/utils";

/** A typed major-unit amount ("450", "12.5") → integer minor units; "" → null. */
export function toMinor(value: string): number | null {
  const n = Number.parseFloat(value.replace(",", "."));
  return value.trim() === "" || Number.isNaN(n) ? null : Math.round(n * 100);
}

/** Minor units → the major-unit text a form field shows. */
export function fromMinor(value: number | null | undefined): string {
  return value == null ? "" : String(value / 100);
}

const BILLING_MODES: GroupBillingMode[] = ["MONTHLY", "PER_LESSON", "COURSE"];
const PAY_MODES: Exclude<GroupTeacherPayMode, null>[] = ["PER_LESSON", "PER_HOUR", "PER_STUDENT", "REVENUE_SHARE"];

/** The first validation message an API refusal carries, else its message. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const errors = (err.body as { errors?: Record<string, string[]> } | undefined)?.errors;
    const first = errors ? Object.values(errors)[0]?.[0] : undefined;
    return first ?? err.message ?? fallback;
  }
  return fallback;
}

function Field({
  label,
  icon: Icon,
  required,
  hint,
  children,
}: {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        {Icon && <Icon className="text-muted-foreground size-3.5" />}
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/**
 * Create or edit a group: who teaches it, how many seats, online or in a room, its dates and its
 * weekly times. Saving regenerates its lessons server-side — future pending ones follow the edit,
 * held and past ones never move — which is what the hints under the timetable say in plain words.
 */
export function GroupForm({
  group,
  onSaved,
  onCancel,
}: {
  /** Absent = create. */
  group?: GroupDetail;
  onSaved: (group: GroupDetail) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("groups");
  const tw = useTranslations("scheduling");
  const { can } = useAuth();
  const editing = group !== undefined;
  // Each half of the money is its own capability, and an edit only shows what the API showed us.
  const canPrice = can("student.set_price") && (!editing || group.pricing !== null);
  const canPay = can("teacher.set_pay") && (!editing || group.teacher_pay !== null);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [name, setName] = useState(group?.name ?? "");
  const [teacherId, setTeacherId] = useState(group?.teacher_id ?? "");
  const [specializationId, setSpecializationId] = useState(group?.specialization_id ?? "");
  const [level, setLevel] = useState(group?.level ?? "");
  const [capacity, setCapacity] = useState(group?.capacity != null ? String(group.capacity) : "");
  const [mode, setMode] = useState<GroupMode>(group?.mode ?? "ONLINE");
  const [location, setLocation] = useState(group?.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(group?.meeting_url ?? "");
  const [startDate, setStartDate] = useState(group?.start_date ?? todayIn(group?.timezone ?? browserTz));
  const [endDate, setEndDate] = useState(group?.end_date ?? "");
  const [notes, setNotes] = useState(group?.notes ?? "");
  const [slots, setSlots] = useState<GroupSlot[]>(
    group?.slots.length ? group.slots : [{ weekday: 1, start_time_local: "17:00", duration_minutes: 60 }],
  );

  const [billingMode, setBillingMode] = useState<GroupBillingMode>(group?.pricing?.billing_mode ?? "MONTHLY");
  const [price, setPrice] = useState(fromMinor(group?.pricing?.price_minor));
  const [currency, setCurrency] = useState(group?.pricing?.currency ?? "");
  const [chargeAbsent, setChargeAbsent] = useState(group?.pricing?.charge_absent ?? false);
  const [prorateJoin, setProrateJoin] = useState(group?.pricing?.prorate_join ?? true);
  // MONTHLY only: the hours one month buys. Empty = the calendar month (the way every group billed
  // before); set = the next month is raised once the group has held that many hours.
  const savedMonthMinutes = group?.pricing?.month_minutes ?? null;
  const [monthHours, setMonthHours] = useState(savedMonthMinutes != null ? hoursText(savedMonthMinutes) : "");
  const [payMode, setPayMode] = useState<GroupTeacherPayMode>(group?.teacher_pay?.mode ?? null);
  const [payAmount, setPayAmount] = useState(fromMinor(group?.teacher_pay?.amount_minor));
  const [sharePct, setSharePct] = useState(
    group?.teacher_pay?.share_bp != null ? String(group.teacher_pay.share_bp / 100) : "",
  );

  const [teachers, setTeachers] = useState<{ value: string; label: string }[]>([]);
  const [subjects, setSubjects] = useState<Specialization[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listTeachers({ pageSize: 200, filter: { status: "active" } })
      .then((res) => setTeachers(res.rows.map((r) => ({ value: r.id, label: r.full_name }))))
      .catch(() => setTeachers([]));
    void listSpecializations()
      .then((res) => setSubjects(res.specializations.filter((s) => s.is_active)))
      .catch(() => setSubjects([]));
  }, []);

  // An edit can be opened on a group whose teacher has since been deactivated: keep them pickable.
  const teacherOptions = useMemo(() => {
    if (group && !teachers.some((o) => o.value === group.teacher_id)) {
      return [{ value: group.teacher_id, label: group.teacher_name ?? "—" }, ...teachers];
    }
    return teachers;
  }, [teachers, group]);

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: tw(`weekday.${d}`) }));

  function updateSlot(i: number, patch: Partial<GroupSlot>) {
    setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function validate(): string | null {
    if (!name.trim()) return t("form.errors.name");
    if (!teacherId) return t("form.errors.teacher");
    if (!startDate) return t("form.errors.startDate");
    if (endDate && endDate < startDate) return t("form.errors.endDate");
    if (slots.length === 0) return t("form.errors.slots");
    const keys = slots.map((s) => `${s.weekday}|${s.start_time_local}`);
    if (new Set(keys).size !== keys.length) return t("form.errors.duplicateSlot");
    if (slots.some((s) => !s.start_time_local || s.duration_minutes < 1 || s.duration_minutes > 600)) {
      return t("form.errors.slotInvalid");
    }
    if (capacity && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1)) return t("form.errors.capacity");
    if (canPrice && price.trim() !== "" && (toMinor(price) ?? -1) < 0) return t("form.errors.price");
    if (canPrice && billingMode === "MONTHLY" && monthHours.trim() !== "" && monthMinutes() === null) {
      return t("form.errors.monthHours");
    }
    if (canPay && payMode !== null && payMode !== "REVENUE_SHARE" && toMinor(payAmount) === null) return t("form.errors.payAmount");
    if (canPay && payMode === "REVENUE_SHARE") {
      const pct = Number.parseFloat(sharePct);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) return t("form.errors.share");
    }
    return null;
  }

  /** The typed hours → minutes; null when empty or not a positive number. */
  function monthMinutes(): number | null {
    const h = Number.parseFloat(monthHours.replace(",", "."));
    if (monthHours.trim() === "" || Number.isNaN(h) || h <= 0 || h > 1000) return null;
    return Math.round(h * 60);
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    const input: GroupInput = {
      name: name.trim(),
      teacher_id: teacherId,
      specialization_id: specializationId || null,
      level: level.trim() || null,
      capacity: capacity ? Number(capacity) : null,
      mode,
      location: mode === "OFFLINE" ? location.trim() || null : null,
      meeting_url: mode === "ONLINE" ? meetingUrl.trim() || null : null,
      start_date: startDate,
      end_date: endDate || null,
      notes: notes.trim() || null,
      slots: sortSlots(slots),
      ...(canPrice
        ? {
            billing_mode: billingMode,
            price_minor: toMinor(price),
            currency: currency || null,
            charge_absent: billingMode === "PER_LESSON" && chargeAbsent,
            prorate_join: prorateJoin,
            month_minutes: billingMode === "MONTHLY" ? monthMinutes() : null,
          }
        : {}),
      ...(canPay
        ? {
            teacher_pay_mode: payMode,
            teacher_pay_minor: payMode !== null && payMode !== "REVENUE_SHARE" ? toMinor(payAmount) : null,
            teacher_share_bp: payMode === "REVENUE_SHARE" ? Math.round(Number.parseFloat(sharePct) * 100) : null,
          }
        : {}),
    };

    setBusy(true);
    setError(null);
    try {
      const res = editing ? await updateGroup(group.id, input) : await createGroup(input);
      onSaved(res.group);
    } catch (err) {
      setError(apiErrorMessage(err, t("form.errors.save")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="group-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t("form.name")} icon={Users} required>
            <input
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("form.namePlaceholder")}
              maxLength={120}
              data-testid="group-name"
            />
          </Field>
        </div>

        <Field label={t("form.teacher")} icon={GraduationCap} required>
          <Combobox
            options={teacherOptions}
            value={teacherId}
            onChange={setTeacherId}
            placeholder={t("form.teacherPlaceholder")}
            searchPlaceholder={t("form.search")}
            data-testid="group-teacher"
          />
        </Field>

        <Field label={t("form.subject")}>
          <select
            className={fieldClass}
            value={specializationId}
            onChange={(e) => setSpecializationId(e.target.value)}
            data-testid="group-subject"
          >
            <option value="">{t("form.noSubject")}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("form.level")}>
          <input
            className={fieldClass}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder={t("form.levelPlaceholder")}
            maxLength={60}
          />
        </Field>

        <Field label={t("form.capacity")} hint={t("form.capacityHint")}>
          <input
            className={fieldClass}
            type="number"
            inputMode="numeric"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder={t("form.capacityPlaceholder")}
            data-testid="group-capacity"
          />
        </Field>
      </div>

      {/* Where the class happens. */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("form.mode")}>
          {(["ONLINE", "OFFLINE"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                mode === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
              )}
            >
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
        {mode === "ONLINE" ? (
          <Field label={t("form.meetingUrl")} icon={Link2} hint={t("form.meetingUrlHint")}>
            <input
              className={fieldClass}
              type="url"
              dir="ltr"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://"
            />
          </Field>
        ) : (
          <Field label={t("form.location")} icon={MapPin}>
            <input
              className={fieldClass}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t("form.locationPlaceholder")}
              maxLength={200}
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("form.startDate")} icon={CalendarDays} required hint={t("form.startDateHint")}>
          <input
            className={fieldClass}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            data-testid="group-start"
          />
        </Field>
        <Field label={t("form.endDate")} icon={CalendarDays} hint={t("form.endDateHint")}>
          <input
            className={fieldClass}
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
      </div>

      {/* The weekly timetable. */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="text-muted-foreground size-3.5" />
          {t("form.slots")}
          <span className="text-destructive">*</span>
        </p>
        <ul className="space-y-2">
          {slots.map((s, i) => (
            <li
              key={i}
              className="grid grid-cols-1 gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center"
              data-testid="group-slot"
            >
              <select
                className={fieldClass}
                value={s.weekday}
                onChange={(e) => updateSlot(i, { weekday: Number(e.target.value) })}
                aria-label={tw("weekdayLabel")}
              >
                {weekdays.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input
                className={cn(fieldClass, "sm:w-32")}
                type="time"
                value={s.start_time_local}
                onChange={(e) => updateSlot(i, { start_time_local: e.target.value })}
                aria-label={tw("startTime")}
              />
              <div className="flex items-center gap-1.5">
                <input
                  className={cn(fieldClass, "w-24")}
                  type="number"
                  min={1}
                  max={600}
                  value={s.duration_minutes}
                  onChange={(e) => updateSlot(i, { duration_minutes: Number(e.target.value) })}
                  aria-label={tw("duration")}
                />
                <span className="text-muted-foreground text-xs">{t("form.minutes")}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSlots((prev) => prev.filter((_, j) => j !== i))}
                aria-label={tw("removeSlot")}
                disabled={slots.length === 1}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            setSlots((prev) => [
              ...prev,
              {
                weekday: ((prev[prev.length - 1]?.weekday ?? 0) + 2) % 7,
                start_time_local: prev[prev.length - 1]?.start_time_local ?? "17:00",
                duration_minutes: prev[prev.length - 1]?.duration_minutes ?? 60,
              },
            ])
          }
          data-testid="group-add-slot"
        >
          <Plus className="size-3.5" />
          {tw("addSlot")}
        </Button>
        <p className="text-muted-foreground text-xs">{editing ? t("form.slotsEditHint") : t("form.slotsHint")}</p>
      </div>

      {canPrice && (
        <section className="space-y-3 rounded-xl border p-3" data-testid="group-pricing">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Wallet className="text-muted-foreground size-4" />
            {t("money.studentPays")}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("money.billingMode")}>
            {BILLING_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={billingMode === m}
                onClick={() => setBillingMode(m)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-start text-sm transition-colors",
                  billingMode === m ? "border-primary bg-primary/10" : "hover:bg-muted",
                )}
                data-testid={`billing-${m}`}
              >
                <span className="block font-medium">{t(`money.mode.${m}`)}</span>
                <span className="text-muted-foreground block text-xs">{t(`money.modeHint.${m}`)}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t(`money.priceLabel.${billingMode}`)} hint={t("money.priceHint")}>
              <input
                className={fieldClass}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={t("money.pricePlaceholder")}
                data-testid="group-price"
              />
            </Field>
            <Field label={t("money.currency")} hint={t("money.currencyHint")}>
              <Combobox
                options={[{ value: "", label: t("money.academyCurrency") }, ...CURRENCIES.map((c) => ({ value: c.code, label: c.code, sublabel: c.name }))]}
                value={currency}
                onChange={setCurrency}
                placeholder={t("money.academyCurrency")}
                searchPlaceholder={t("form.search")}
              />
            </Field>
          </div>
          {billingMode === "MONTHLY" && (
            <Field label={t("money.monthHours")} icon={Clock} hint={monthHours.trim() ? t("money.monthHoursOnHint", { hours: monthHours.trim() }) : t("money.monthHoursHint")}>
              <input
                className={cn(fieldClass, "sm:w-40")}
                inputMode="decimal"
                value={monthHours}
                onChange={(e) => setMonthHours(e.target.value)}
                placeholder={t("money.monthHoursPlaceholder")}
                data-testid="group-month-hours"
              />
            </Field>
          )}
          {billingMode === "MONTHLY" && editing && (savedMonthMinutes === null) !== (monthHours.trim() === "") && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {t("money.monthHoursSwitchHint")}
            </p>
          )}
          {billingMode === "MONTHLY" && monthHours.trim() === "" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={prorateJoin} onChange={(e) => setProrateJoin(e.target.checked)} />
              {t("money.prorateJoin")}
            </label>
          )}
          {billingMode === "PER_LESSON" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chargeAbsent} onChange={(e) => setChargeAbsent(e.target.checked)} />
              {t("money.chargeAbsent")}
            </label>
          )}
          {editing && <p className="text-muted-foreground text-xs">{t("money.forwardOnly")}</p>}
        </section>
      )}

      {canPay && (
        <section className="space-y-3 rounded-xl border p-3" data-testid="group-teacher-pay">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Coins className="text-muted-foreground size-4" />
            {t("money.teacherEarns")}
          </p>
          <select
            className={fieldClass}
            value={payMode ?? ""}
            onChange={(e) => setPayMode((e.target.value || null) as GroupTeacherPayMode)}
            aria-label={t("money.teacherEarns")}
            data-testid="group-pay-mode"
          >
            <option value="">{t("money.payMode.DEFAULT")}</option>
            {PAY_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`money.payMode.${m}`)}
              </option>
            ))}
          </select>
          {payMode !== null && payMode !== "REVENUE_SHARE" && (
            <Field label={t(`money.payAmount.${payMode}`)} hint={t("money.payCurrencyHint")}>
              <input className={fieldClass} inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} data-testid="group-pay-amount" />
            </Field>
          )}
          {payMode === "REVENUE_SHARE" && (
            <Field label={t("money.sharePct")} hint={t("money.shareHint")}>
              <input className={fieldClass} inputMode="decimal" value={sharePct} onChange={(e) => setSharePct(e.target.value)} placeholder="50" data-testid="group-share" />
            </Field>
          )}
          <p className="text-muted-foreground text-xs">{t(`money.payModeHint.${payMode ?? "DEFAULT"}`)}</p>
        </section>
      )}

      <Field label={t("form.notes")}>
        <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={busy} data-testid="group-save">
          {busy ? t("form.saving") : editing ? t("form.saveChanges") : t("form.create")}
        </Button>
      </div>
    </div>
  );
}
