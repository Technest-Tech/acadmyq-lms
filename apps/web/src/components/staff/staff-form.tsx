"use client";

import {
  AtSign,
  Banknote,
  Briefcase,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Phone,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption, DialCodePicker } from "@/components/ui/combobox";
import {
  ApiError,
  createStaff,
  listStaffDepartments,
  type StaffDepartment,
  type StaffInput,
  updateStaff,
  type StaffRow,
} from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

// ── Field wrapper ────────────────────────────────────────────────────────────

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

// ── StaffForm ────────────────────────────────────────────────────────────────

export function StaffForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: StaffRow;
  onDone: (id: string, name: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("staff");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [departments, setDepartments] = useState<StaffDepartment[]>([]);

  const [fullName, setFullName]       = useState(initial?.full_name ?? "");
  const [department, setDepartment]   = useState<string>(initial?.department ?? "");
  const [dialCountry, setDialCountry] = useState("EG");

  useEffect(() => {
    listStaffDepartments()
      .then((res) => {
        const active = res.departments.filter((d) => d.is_active);
        setDepartments(active);
        if (!initial?.department && active.length > 0) {
          setDepartment(active[0]!.name);
        }
      })
      .catch(() => {});
  }, [initial?.department]);
  const [localNumber, setLocalNumber] = useState(initial?.phone ?? "");
  const [salary, setSalary]           = useState(
    initial?.salary_minor ? String(initial.salary_minor / 100) : "",
  );
  const [currency, setCurrency]       = useState(initial?.currency ?? "EGP");
  const [notes, setNotes]             = useState(initial?.notes ?? "");
  const [createLogin, setCreateLogin] = useState(false);
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const isEditing = !!initial;

  const deptOptions = departments.map<ComboboxOption>((d) => ({
    value: d.name,
    label: d.name,
  }));

  function buildPhone(): string | null {
    if (!localNumber) return null;
    const entry = COUNTRIES.find((c) => c.code === dialCountry);
    return entry ? entry.dialCode + localNumber : localNumber;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const input: StaffInput = {
        full_name:    fullName,
        department,
        phone:        buildPhone(),
        salary_minor: toMinor(salary),
        currency:     currency || undefined,
        notes:        notes || null,
        ...(!isEditing && {
          create_login: createLogin,
          email:        createLogin ? email : null,
          password:     createLogin ? password : null,
        }),
      };

      if (isEditing) {
        await updateStaff(initial.id, input);
        onDone(initial.id, fullName);
      } else {
        const res = await createStaff(input);
        onDone(res.staffId, fullName);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit} data-testid="staff-form">
      {error && <AlertBanner variant="error" message={error} />}

      {/* Full name */}
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

      {/* Department */}
      <Field label={t("form.department")} required>
        <div className="relative">
          <Briefcase className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10" />
          <Combobox
            options={deptOptions}
            value={department}
            onChange={setDepartment}
            placeholder={t("form.departmentPlaceholder")}
            searchPlaceholder={t("form.searchDepartment")}
            data-testid="department-select"
          />
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        {/* Phone */}
        <Field label={t("form.phone")}>
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
              aria-label={t("form.phone")}
              placeholder="1001234567"
              value={localNumber}
              onChange={(e) => setLocalNumber(e.target.value.replace(/[^\d]/g, ""))}
              className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground tabular-nums"
            />
          </div>
        </Field>

        {/* Monthly salary */}
        <Field label={t("form.salary")}>
          <div className="relative">
            <Banknote className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="number"
              step="0.01"
              min="0"
              aria-label={t("form.salary")}
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5 tabular-nums")}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
            />
          </div>
        </Field>

        {/* Currency */}
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

      {/* Notes */}
      <Field label={t("form.notes")}>
        <div className="relative">
          <FileText className="pointer-events-none absolute start-3.5 top-3.5 size-4 text-muted-foreground" />
          <textarea
            aria-label={t("form.notes")}
            rows={3}
            placeholder={t("form.notesPlaceholder")}
            className={cn(inputBase, "resize-none py-2.5 ps-10 pe-3.5")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Field>

      {/* Optional login — only on create */}
      {!isEditing && (
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
                    data-testid="staff-password"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? t("form.hidePassword") : t("form.showPassword")}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("back")}
        </Button>
        <Button type="submit" size="sm" disabled={busy} className="gap-1.5">
          {busy ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
              {isEditing ? t("form.saving") : t("form.creating")}
            </>
          ) : (
            isEditing ? t("form.save") : t("form.create")
          )}
        </Button>
      </div>
    </form>
  );
}
