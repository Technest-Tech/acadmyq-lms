"use client";

import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  Check,
  MessageCircle,
  ShieldAlert,
  User,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AvailabilityEditor } from "@/components/teachers/availability-editor";
import { TeacherLoginSection } from "@/components/teachers/teacher-login-section";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  type ComboboxOption,
  DialCodePicker,
} from "@/components/ui/combobox";
import {
  ApiError,
  type AvailabilityWindow,
  deactivateTeacher,
  getTeacher,
  listSpecializations,
  type Specialization,
  type TeacherLogin,
  type TeacherRow,
  type TeacherStudent,
  updateTeacher,
} from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const dialOptions: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  sublabel: c.dialCode,
  pre: c.flag,
}));

const currencyOptions: ComboboxOption[] = CURRENCIES.map((c) => ({
  value: c.code,
  label: c.code,
  sublabel: c.name,
}));

/** Split a stored E.164 phone into a dial-country ISO code + local digits (default Egypt). */
function splitPhone(phone: string | null): { code: string; local: string } {
  if (!phone) return { code: "EG", local: "" };
  const match = COUNTRIES.filter((c) => phone.startsWith(c.dialCode)).sort(
    (a, b) => b.dialCode.length - a.dialCode.length,
  )[0];
  return match
    ? { code: match.code, local: phone.slice(match.dialCode.length) }
    : { code: "EG", local: phone.replace(/[^\d]/g, "") };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const sizeClass =
    size === "lg"
      ? "size-14 rounded-2xl text-base"
      : "size-8 rounded-full text-[11px]";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center font-bold text-white shadow-sm",
        sizeClass,
      )}
      style={{ backgroundColor: `hsl(${nameHue(name)} 52% 44%)` }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

// ── Component ─────────────────────────────────────────────────────────────────

/** Teacher detail: edit the session rate (audited) + availability, see current students. */
export function TeacherDetail({
  teacherId,
  onBack,
  onSaved,
  onDeactivated,
  showHero = true,
}: {
  teacherId: string;
  onBack: () => void;
  onSaved?: () => void;
  onDeactivated?: () => void;
  /** Show the avatar/name/status hero. Off when a parent page already renders the header. */
  showHero?: boolean;
}) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const { can } = useAuth();

  const [teacher, setTeacher] = useState<TeacherRow | null>(null);
  const [students, setStudents] = useState<TeacherStudent[]>([]);
  const [login, setLogin] = useState<TeacherLogin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [fullName, setFullName] = useState("");
  const [dialCountry, setDialCountry] = useState("EG");
  const [localNumber, setLocalNumber] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [specs, setSpecs] = useState<Specialization[]>([]);

  function buildPhone(): string | null {
    if (!localNumber) return null;
    const dialEntry = COUNTRIES.find((c) => c.code === dialCountry);
    return dialEntry ? dialEntry.dialCode + localNumber : localNumber;
  }

  useEffect(() => {
    void listSpecializations()
      .then((r) => setSpecs(r.specializations.filter((s) => s.is_active)))
      .catch(() => setSpecs([]));
  }, []);

  // Active options + the teacher's current value (even if it was retired) so it still shows.
  const specOptions = useMemo<ComboboxOption[]>(() => {
    const names = new Set(specs.map((s) => s.name));
    const opts: ComboboxOption[] = [
      { value: "", label: t("form.noSpecialization") },
      ...specs.map((s) => ({ value: s.name, label: s.name })),
    ];
    if (specialization && !names.has(specialization)) {
      opts.push({ value: specialization, label: specialization });
    }
    return opts;
  }, [specs, specialization, t]);

  const refresh = useCallback(async () => {
    const res = await getTeacher(teacherId);
    setTeacher(res.teacher);
    setStudents(res.students);
    setLogin(res.login);
    setRate((res.teacher.session_rate_minor / 100).toString());
    setCurrency(res.teacher.currency);
    setFullName(res.teacher.full_name);
    const { code, local } = splitPhone(res.teacher.phone);
    setDialCountry(code);
    setLocalNumber(local);
    setSpecialization(res.teacher.specialization ?? "");
    setAvailability(res.teacher.availability ?? []);
  }, [teacherId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (teacher === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <div className="border-primary size-7 animate-spin rounded-full border-2 border-t-transparent" />
        <p className="text-muted-foreground text-xs">Loading profile…</p>
      </div>
    );
  }

  const canEdit = can("teacher.update");
  const isActive = teacher.deleted_at == null;

  async function save() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await updateTeacher(teacherId, {
        full_name: fullName,
        phone: buildPhone(),
        session_rate_minor: toMinor(rate),
        currency,
        specialization: specialization || null,
        availability,
      });
      setNotice(t("form.saved"));
      onSaved?.();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="teacher-detail">
      {/* ── Profile hero ────────────────────────────────────────────── */}
      {showHero && (
      <div className="flex items-start gap-4 rounded-2xl border bg-gradient-to-br from-muted/60 to-muted/10 p-5">
        <Avatar name={teacher.full_name} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-tight">
            {teacher.full_name}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {isActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {t("stat.active")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                <span className="size-1.5 rounded-full bg-slate-400" />
                {t("stat.inactive")}
              </span>
            )}
            {teacher.specialization && (
              <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                <BadgeCheck className="size-3" />
                {teacher.specialization}
              </span>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="teacher-rate"
            >
              <Banknote className="size-3.5 shrink-0" aria-hidden />
              {formatMoney(
                {
                  amount: teacher.session_rate_minor,
                  currency: teacher.currency,
                },
                locale,
              )}
            </span>
            {teacher.phone && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                <MessageCircle className="size-3.5 shrink-0" aria-hidden />
                {teacher.phone}
              </span>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      {notice && (
        <AlertBanner
          variant="success"
          message={notice}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* ── Profile section ──────────────────────────────────────────── */}
      <section className="space-y-4" data-testid="teacher-profile">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {t("detail.profile")}
        </p>

        <Field label={t("form.fullName")}>
          <div className="relative">
            <User className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label={t("form.fullName")}
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
              value={fullName}
              disabled={!canEdit}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
        </Field>

        <Field label={t("form.whatsapp")}>
          <div
            dir="ltr"
            className={cn(
              "border-input flex h-10 overflow-hidden rounded-xl border transition-all",
              "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
              !canEdit && "opacity-50",
            )}
          >
            <DialCodePicker
              options={dialOptions}
              value={dialCountry}
              onChange={setDialCountry}
              searchPlaceholder={t("form.dialSearch")}
            />
            <input
              dir="ltr"
              type="tel"
              inputMode="numeric"
              aria-label={t("form.whatsapp")}
              placeholder="1001234567"
              value={localNumber}
              disabled={!canEdit}
              onChange={(e) =>
                setLocalNumber(e.target.value.replace(/[^\d]/g, ""))
              }
              className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground tabular-nums"
            />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("form.specialization")}>
            <Combobox
              options={specOptions}
              value={specialization}
              onChange={setSpecialization}
              placeholder={t("form.noSpecialization")}
              searchPlaceholder={t("form.searchSpecialization")}
              disabled={!canEdit}
              data-testid="specialization-select"
            />
          </Field>

          <Field label={t("form.rate")}>
            <div className="relative">
              <Banknote className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="number"
                step="0.01"
                aria-label={t("form.rate")}
                className={cn(inputBase, "py-2.5 ps-10 pe-3.5 tabular-nums")}
                value={rate}
                disabled={!canEdit}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
          </Field>

          <Field label={t("form.currency")}>
            <Combobox
              options={currencyOptions}
              value={currency}
              onChange={setCurrency}
              placeholder={t("form.currency")}
              searchPlaceholder={t("form.searchCurrency")}
              disabled={!canEdit}
              data-testid="currency-select"
            />
          </Field>
        </div>

        <Field label={t("detail.availability")}>
          <AvailabilityEditor
            value={availability}
            onChange={setAvailability}
            disabled={!canEdit}
          />
        </Field>

        {canEdit && (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void save()}
              data-testid="save-teacher"
              className="gap-1.5"
            >
              {saving ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                  {t("form.saving")}
                </>
              ) : (
                <>
                  <Check className="size-3.5" />
                  {t("form.save")}
                </>
              )}
            </Button>
          </div>
        )}
      </section>

      {/* ── Account / login section ──────────────────────────────────── */}
      {login && (
        <TeacherLoginSection
          teacherId={teacherId}
          login={login}
          onChanged={refresh}
        />
      )}

      {/* ── Students section ─────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="teacher-students">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {t("detail.students")}
          {students.length > 0 && (
            <span className="ms-1.5 text-muted-foreground/50">
              ({students.length})
            </span>
          )}
        </p>
        {students.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.noStudents")}
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border text-sm">
            {students.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 px-4 py-2.5"
                data-student={s.id}
              >
                <Avatar name={s.full_name} />
                <span className="flex-1 font-medium">{s.full_name}</span>
                {s.started_at && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                    <CalendarClock className="size-3 shrink-0" aria-hidden />
                    {t("detail.since")} {s.started_at.slice(0, 10)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Danger zone ──────────────────────────────────────────────── */}
      {can("teacher.deactivate") && isActive && (
        <DangerZone
          teacherId={teacherId}
          onDeactivated={() => {
            onDeactivated?.();
            onBack();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

// ── DangerZone ────────────────────────────────────────────────────────────────

function DangerZone({
  teacherId,
  onDeactivated,
  onError,
}: {
  teacherId: string;
  onDeactivated: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("teachers");
  const [confirm, setConfirm] = useState(false);

  return (
    <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
      {!confirm ? (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 size-4 shrink-0 text-destructive/60"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold text-destructive">
                {t("detail.deactivate")}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t("detail.deactivateHint")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={() => setConfirm(true)}
            data-testid="deactivate-teacher"
          >
            {t("detail.deactivate")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-destructive">
            {t("detail.deactivateConfirm")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("detail.deactivateConfirmBody")}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setConfirm(false)}
            >
              {t("detail.deactivateCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              data-testid="confirm-deactivate-teacher"
              onClick={async () => {
                try {
                  await deactivateTeacher(teacherId);
                  onDeactivated();
                } catch (err) {
                  onError(
                    err instanceof ApiError
                      ? t("detail.deactivateBlocked")
                      : String(err),
                  );
                  setConfirm(false);
                }
              }}
            >
              {t("detail.deactivateYes")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
