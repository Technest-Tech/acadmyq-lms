"use client";

import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  Check,
  Clock,
  MessageCircle,
  ShieldAlert,
  User,
  Users,
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
import { Modal } from "@/components/ui/modal";
import { FactCard, ProfileCard } from "@/components/ui/profile-card";
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
        <p className="text-muted-foreground text-xs">{t("detail.loading")}</p>
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
    <div className="space-y-4" data-testid="teacher-detail">
      {/* ── Profile hero ────────────────────────────────────────────────
          Only when this component stands alone (the modal path). Inside the workspace the page
          already carries a hero and a fact strip, so it renders straight into the cards. */}
      {showHero && (
        <div className="grid gap-3 sm:grid-cols-3">
          <FactCard
            icon={isActive ? BadgeCheck : ShieldAlert}
            label={t("filter.status")}
            tone={isActive ? "emerald" : "slate"}
            value={isActive ? t("stat.active") : t("stat.inactive")}
            sub={teacher.specialization ?? undefined}
          />
          <FactCard
            icon={Banknote}
            label={t("colRate")}
            tone="violet"
            value={
              <span data-testid="teacher-rate">
                {formatMoney(
                  {
                    amount: teacher.session_rate_minor,
                    currency: teacher.currency,
                  },
                  locale,
                )}
              </span>
            }
            sub={t("fact.perHour")}
          />
          <FactCard
            icon={MessageCircle}
            label={t("colWhatsapp")}
            tone="emerald"
            muted={!teacher.phone}
            value={
              teacher.phone ? (
                <span dir="ltr" className="tabular-nums">
                  {teacher.phone}
                </span>
              ) : (
                t("form.none")
              )
            }
          />
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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Identity & pay ─────────────────────────────────────────── */}
        <ProfileCard
          icon={User}
          title={t("detail.profileTitle")}
          description={t("detail.profileDesc")}
          tone="emerald"
          testId="teacher-profile"
        >
          <div className="space-y-4">
            <Field label={t("form.fullName")}>
              <div className="relative">
                <User className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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
                  "focus-within:border-primary focus-within:ring-primary/20 focus-within:ring-2",
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
                  className="placeholder:text-muted-foreground flex-1 bg-transparent px-3 text-sm tabular-nums outline-none"
                />
              </div>
            </Field>

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

            {/* The rate and its currency are one decision — they sit on one row so nobody
                changes 80 → 90 without noticing it is EGP and not USD. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("form.rate")}>
                <div className="relative">
                  <Banknote className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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

            {canEdit && (
              <div className="flex justify-end border-t pt-4">
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
          </div>
        </ProfileCard>

        {/* ── Availability ───────────────────────────────────────────── */}
        <ProfileCard
          icon={Clock}
          title={t("detail.availability")}
          description={t("detail.availabilityDesc")}
          tone="gold"
        >
          <div className="space-y-4">
            <AvailabilityEditor
              value={availability}
              onChange={setAvailability}
              disabled={!canEdit}
            />
            {canEdit && (
              <p className="text-muted-foreground/80 border-t pt-3 text-[11px]">
                {t("detail.availabilitySaveHint")}
              </p>
            )}
          </div>
        </ProfileCard>
      </div>

      {/* ── Account / login ──────────────────────────────────────────── */}
      {login && (
        <TeacherLoginSection
          teacherId={teacherId}
          login={login}
          onChanged={refresh}
        />
      )}

      {/* ── Students ─────────────────────────────────────────────────── */}
      <ProfileCard
        icon={Users}
        title={t("detail.students")}
        description={t("detail.studentsDesc")}
        tone="violet"
        testId="teacher-students"
        action={
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
            {students.length}
          </span>
        }
      >
        {students.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed py-8 text-center">
            <Users className="text-muted-foreground/30 mb-2 size-8" aria-hidden />
            <p className="text-muted-foreground text-sm">{t("detail.noStudents")}</p>
          </div>
        ) : (
          <ul className="divide-border/70 divide-y overflow-hidden rounded-xl border text-sm">
            {students.map((s) => (
              <li
                key={s.id}
                className="hover:bg-muted/30 flex items-center gap-3 px-4 py-2.5 transition-colors"
                data-student={s.id}
              >
                <Avatar name={s.full_name} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {s.full_name}
                </span>
                {s.started_at && (
                  <span className="text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums">
                    <CalendarClock className="size-3 shrink-0" aria-hidden />
                    {t("detail.since")} {s.started_at.slice(0, 10)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </ProfileCard>

      {/* ── Danger zone ──────────────────────────────────────────────── */}
      {can("teacher.deactivate") && isActive && (
        <DangerZone
          teacherId={teacherId}
          studentCount={students.length}
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

/**
 * Deactivating a teacher is refused by the server while students are still assigned to them —
 * so the card says so, and disables the button, instead of letting the click fail.
 */
function DangerZone({
  teacherId,
  studentCount,
  onDeactivated,
  onError,
}: {
  teacherId: string;
  studentCount: number;
  onDeactivated: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("teachers");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = studentCount > 0;

  return (
    <ProfileCard
      icon={ShieldAlert}
      title={t("detail.deactivate")}
      description={t("detail.deactivateHint")}
      tone="danger"
      className="border-destructive/25"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={cn(
            "min-w-0 text-xs",
            blocked ? "text-destructive font-medium" : "text-muted-foreground",
          )}
        >
          {blocked
            ? t("detail.deactivateBlockedCount", { count: studentCount })
            : t("detail.deactivateSafe")}
        </p>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={blocked}
          onClick={() => setConfirm(true)}
          data-testid="deactivate-teacher"
          className="shrink-0"
        >
          {t("detail.deactivate")}
        </Button>
      </div>

      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title={t("detail.deactivateConfirm")}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              {t("detail.deactivateCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              data-testid="confirm-deactivate-teacher"
              onClick={async () => {
                setBusy(true);
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
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("detail.deactivateYes")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("detail.deactivateConfirmBody")}</p>
      </Modal>
    </ProfileCard>
  );
}
