"use client";

import {
  AtSign,
  Banknote,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption, DialCodePicker } from "@/components/ui/combobox";
import {
  type AcademyRoleSummary,
  ApiError,
  createStaff,
  listAcademyRoles,
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

// ── Section card ───────────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card/40 p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-4.5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {description && (
            <p className="text-muted-foreground mt-0.5 text-xs leading-snug">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// ── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ms-0.5">*</span>}
      </label>
      {hint && <p className="text-muted-foreground -mt-1 text-xs leading-snug">{hint}</p>}
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
  const tp = useTranslations("permissions");
  // Friendly, localized label for a raw capability code (falls back to the code).
  const permLabel = (code: string) => {
    const k = `items.${code.replace(/\./g, "_")}.label`;
    return tp.has(k) ? tp(k) : code;
  };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName]       = useState(initial?.full_name ?? "");
  const [dialCountry, setDialCountry] = useState("EG");
  const [localNumber, setLocalNumber] = useState(initial?.phone ?? "");
  const [salary, setSalary]           = useState(
    initial?.salary_minor ? String(initial.salary_minor / 100) : "",
  );
  const [currency, setCurrency]       = useState(initial?.currency ?? "EGP");
  const [notes, setNotes]             = useState(initial?.notes ?? "");
  const [department, setDepartment]   = useState(initial?.department ?? "");
  const [departments, setDepartments] = useState<StaffDepartment[]>([]);
  // An employee gets a login + role by default (uncheck to record a login-less staff member).
  const [createLogin, setCreateLogin] = useState(!initial);
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole]               = useState("STAFF");
  const [roles, setRoles]             = useState<AcademyRoleSummary[]>([]);

  const isEditing = !!initial;

  // The department catalog is a platform list (Admin → Staff departments), not a fixed enum —
  // so the picker is fetched. Until this existed in the form, every staff member was written as
  // "OTHER" no matter what, which is why the roster column had nothing to show.
  useEffect(() => {
    listStaffDepartments()
      .then((res) => setDepartments(res.departments.filter((d) => d.is_active)))
      .catch(() => setDepartments([]));
  }, []);

  const departmentOptions = useMemo<ComboboxOption[]>(() => {
    const names = new Set(departments.map((d) => d.name));
    const opts = departments.map((d) => ({ value: d.name, label: d.name }));
    // A department that was later retired still has to display on the member holding it.
    if (department && !names.has(department)) {
      opts.push({ value: department, label: department });
    }
    return opts;
  }, [departments, department]);

  // The roles an employee can be given: the STAFF baseline plus the academy's OWN active custom
  // roles (built on the Roles page). Fetched on mount in create mode; listing needs role.manage,
  // which the owner holds — a failure just leaves the STAFF baseline.
  useEffect(() => {
    if (isEditing) return;
    listAcademyRoles()
      .then((res) => {
        const staff = res.system.find((r) => r.code === "STAFF");
        setRoles([
          ...(staff ? [staff] : []),
          ...res.custom.filter((r) => r.isActive !== false),
        ]);
      })
      .catch(() => {});
  }, [isEditing]);

  // Always offer at least the STAFF baseline (until the fetch resolves / if it fails).
  const roleList: AcademyRoleSummary[] = roles.length > 0
    ? roles
    : [{ code: "STAFF", name: "STAFF", system: true, permissions: [], assignedCount: 0 }];
  const selectedRole = roleList.find((r) => r.code === role) ?? null;

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
        department:   department || undefined,
        phone:        buildPhone(),
        salary_minor: toMinor(salary),
        currency:     currency || undefined,
        notes:        notes || null,
        ...(!isEditing && {
          create_login: createLogin,
          email:        createLogin ? email : null,
          password:     createLogin ? password : null,
          role:         createLogin ? role : null,
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

      {/* ── Profile ───────────────────────────────────────────────────────── */}
      <Section icon={User} title={t("form.sectionProfile")} description={t("form.sectionProfileDesc")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Full name */}
          <Field label={t("form.fullName")} required>
            <div className="relative">
              <User className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
              <input
                aria-label={t("form.fullName")}
                className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
          </Field>

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
                className="placeholder:text-muted-foreground flex-1 bg-transparent px-3 text-sm tabular-nums outline-none"
              />
            </div>
          </Field>
        </div>

        {/* Department — organizational only; access is decided by the role below. */}
        <Field label={t("form.department")}>
          <Combobox
            options={departmentOptions}
            value={department}
            onChange={setDepartment}
            placeholder={t("form.departmentPlaceholder")}
            searchPlaceholder={t("form.searchDepartment")}
            data-testid="department-select"
          />
          <p className="text-muted-foreground/80 mt-1 text-[11px]">
            {t("form.departmentHint")}
          </p>
        </Field>

        {/* Notes */}
        <Field label={t("form.notes")}>
          <div className="relative">
            <FileText className="text-muted-foreground pointer-events-none absolute start-3.5 top-3.5 size-4" />
            <textarea
              aria-label={t("form.notes")}
              rows={2}
              placeholder={t("form.notesPlaceholder")}
              className={cn(inputBase, "resize-none py-2.5 ps-10 pe-3.5")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </Field>
      </Section>

      {/* ── Compensation ──────────────────────────────────────────────────── */}
      <Section icon={Wallet} title={t("form.sectionPay")} description={t("form.sectionPayDesc")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Monthly salary */}
          <Field label={t("form.salary")}>
            <div className="relative">
              <Banknote className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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
      </Section>

      {/* ── Account & access (create only) ────────────────────────────────── */}
      {!isEditing && (
        <Section
          icon={ShieldCheck}
          title={t("form.sectionAccount")}
          description={t("form.sectionAccountDesc")}
        >
          {/* Toggle: create a login */}
          <label className="hover:bg-muted/30 flex cursor-pointer items-center justify-between gap-4 rounded-xl border bg-background p-3.5 transition-colors">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                <KeyRound className="size-4" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-medium">{t("form.createLogin")}</p>
                <p className="text-muted-foreground text-xs">{t("form.createLoginDesc")}</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={createLogin}
              onChange={(e) => setCreateLogin(e.target.checked)}
              data-testid="create-login"
              className="border-input accent-primary size-4 shrink-0 rounded"
            />
          </label>

          {createLogin && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("form.email")} required>
                  <div className="relative">
                    <AtSign className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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
                    <KeyRound className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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
                      className="text-muted-foreground hover:text-foreground absolute end-3 top-1/2 -translate-y-1/2"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>
              </div>

              {/* Login role — the STAFF baseline + the academy's OWN custom roles. */}
              <Field label={t("form.role")} hint={t("form.roleHint")}>
                <Combobox
                  options={roleList.map<ComboboxOption>((r) => ({
                    value: r.code,
                    label: r.code === "STAFF" ? t("form.roleStaff") : r.name,
                    sublabel: r.description ?? undefined,
                  }))}
                  value={role}
                  onChange={setRole}
                  placeholder={t("form.roleStaff")}
                  searchPlaceholder={t("form.searchRole")}
                  data-testid="role-select"
                />
              </Field>

              {/* What the chosen role lets this employee do. */}
              {selectedRole && (
                <div className="bg-background rounded-xl border p-3">
                  <p className="mb-2 text-xs font-semibold">{t("form.roleCan")}</p>
                  {selectedRole.permissions.length === 0 ? (
                    <p className="text-muted-foreground text-xs">{t("form.roleNoPerms")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedRole.permissions.map((code) => (
                        <span
                          key={code}
                          className="bg-primary/8 text-primary rounded-md px-2 py-0.5 text-xs font-medium"
                          title={code}
                        >
                          {permLabel(code)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="text-muted-foreground text-xs">
                {t("form.manageRolesHint")}{" "}
                <Link href="/roles" className="text-primary font-medium underline">
                  {t("form.manageRolesLink")}
                </Link>
              </p>
            </>
          )}
        </Section>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="bg-card sticky bottom-0 -mx-1 flex justify-end gap-2 border-t px-1 pt-4">
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
