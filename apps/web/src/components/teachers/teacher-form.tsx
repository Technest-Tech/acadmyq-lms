"use client";

import { AtSign, Banknote, Check, Eye, EyeOff, KeyRound, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AvailabilityEditor } from "@/components/teachers/availability-editor";
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
  createTeacher,
  listSpecializations,
  type Specialization,
  type TeacherInput,
} from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

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

function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

/** Create a teacher: name, session rate (drives payroll), availability and an optional login. */
export function TeacherForm({
  onCreated,
  onCancel,
}: {
  onCreated: (teacherId: string, name: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("teachers");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [dialCountry, setDialCountry] = useState("EG");
  const [localNumber, setLocalNumber] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [createLogin, setCreateLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const specOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: "", label: t("form.noSpecialization") },
      ...specs.map((s) => ({ value: s.name, label: s.name })),
    ],
    [specs, t],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const input: TeacherInput = {
        full_name: fullName,
        phone: buildPhone(),
        specialization: specialization || null,
        session_rate_minor: toMinor(rate),
        currency: currency || undefined,
        availability,
        create_login: createLogin,
        email: createLogin ? email : null,
        password: createLogin ? password : null,
      };
      const res = await createTeacher(input);
      onCreated(res.teacherId, fullName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit} data-testid="teacher-form">
      {error && <AlertBanner variant="error" message={error} />}

      <Field label={t("form.fullName")} required>
        <div className="relative">
          <User className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label={t("form.fullName")}
            className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
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
            data-testid="specialization-select"
          />
        </Field>

        <Field label={t("form.whatsapp")}>
          <div
            dir="ltr"
            className={cn(
              "border-input flex h-10 overflow-hidden rounded-xl border transition-all",
              "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
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
              onChange={(e) =>
                setLocalNumber(e.target.value.replace(/[^\d]/g, ""))
              }
              className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground tabular-nums"
            />
          </div>
        </Field>

        <Field label={t("form.rate")} required>
          <div className="relative">
            <Banknote className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="number"
              step="0.01"
              aria-label={t("form.rate")}
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5 tabular-nums")}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
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
            data-testid="currency-select"
          />
        </Field>
      </div>

      <Field label={t("detail.availability")}>
        <AvailabilityEditor value={availability} onChange={setAvailability} />
      </Field>

      <div className="rounded-xl border bg-muted/20 p-3">
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={createLogin}
            onChange={(e) => setCreateLogin(e.target.checked)}
            data-testid="create-login"
            className="size-4 rounded border-input accent-primary"
          />
          <span className="font-medium">{t("form.createLogin")}</span>
        </label>
        {createLogin && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label={t("form.email")} required>
              <div className="relative">
                <AtSign className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  aria-label={t("form.email")}
                  className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required={createLogin}
                />
              </div>
            </Field>
            <Field label={t("form.password")} required>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  aria-label={t("form.password")}
                  className={cn(inputBase, "py-2.5 ps-10 pe-10")}
                  placeholder={t("form.passwordHint")}
                  value={password}
                  minLength={8}
                  onChange={(e) => setPassword(e.target.value)}
                  required={createLogin}
                  data-testid="teacher-password"
                />
                <button
                  type="button"
                  aria-label={showPassword ? t("form.hidePassword") : t("form.showPassword")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </Field>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("back")}
        </Button>
        <Button type="submit" size="sm" disabled={busy} className="gap-1.5">
          {busy ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
              {t("form.creating")}
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              {t("form.create")}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
