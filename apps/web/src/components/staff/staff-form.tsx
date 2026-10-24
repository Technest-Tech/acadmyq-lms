"use client";

import {
  AtSign,
  Banknote,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  ShieldCheck,
  User,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { withLeftovers } from "@/components/team/role-areas";
import { RolePicker } from "@/components/team/role-picker";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption, DialCodePicker } from "@/components/ui/combobox";
import {
  type AcademyRoleArea,
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
import { STAFF_ROLES } from "@/lib/roles";
import { useAcademyDefaults } from "@/lib/academy-defaults";
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

/**
 * Adding a team member is ONE step: who they are, how they sign in, and which role they get — the
 * shared built-ins (view only, customer service, supervisor, accountant, manager) or the academy's
 * own. Everything an owner rarely needs on day one — department, notes, salary — waits in an
 * optional section, and the salary is only there for someone allowed to set it (staff.set_salary).
 *
 * Editing an existing member covers the record only; their login and role are managed on their
 * page (StaffLoginSection).
 */
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
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isEditing = !!initial;
  const canSalary = can("staff.set_salary");

  const [fullName, setFullName]       = useState(initial?.full_name ?? "");
  // The academy's own defaults (Settings → Academy) open the pickers; the form can still change them.
  const defaults = useAcademyDefaults();
  const [dialCountry, setDialCountry] = useState(defaults.dialCountry);
  const [localNumber, setLocalNumber] = useState(initial?.phone ?? "");
  const [salary, setSalary]           = useState(
    initial?.salary_minor ? String(initial.salary_minor / 100) : "",
  );
  const [currency, setCurrency]       = useState(initial?.currency ?? (defaults.currency || "EGP"));
  const [notes, setNotes]             = useState(initial?.notes ?? "");
  const [department, setDepartment]   = useState(initial?.department ?? "");
  const [departments, setDepartments] = useState<StaffDepartment[]>([]);
  // The optional details start open when editing (that is what an edit is for) and closed on add.
  const [detailsOpen, setDetailsOpen] = useState(isEditing);
  // A new member gets a login + role by default (untick to record someone who never signs in).
  const [createLogin, setCreateLogin] = useState(!initial);
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole]               = useState<string>("STAFF");
  const [roles, setRoles]             = useState<AcademyRoleSummary[]>([]);
  const [areas, setAreas]             = useState<AcademyRoleArea[]>([]);

  // The department catalog is a platform list (Admin → Staff departments), not a fixed enum.
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

  // The roles on offer: the shared built-ins weakest first, then the academy's own active roles —
  // only those this user could actually hand out (the API refuses a role bigger than its giver).
  // Listing needs role.manage; without it the built-ins remain, unsummarised.
  useEffect(() => {
    if (isEditing) return;
    listAcademyRoles()
      .then((res) => {
        const builtIn = STAFF_ROLES.map((code) => res.system.find((r) => r.code === code)).filter(
          (r): r is AcademyRoleSummary => r !== undefined,
        );
        setRoles([...builtIn, ...res.custom.filter((r) => r.isActive !== false)]);
        setAreas(withLeftovers(res.areas ?? [], res.grantable));
      })
      .catch(() => {});
  }, [isEditing]);

  const roleList: AcademyRoleSummary[] = useMemo(() => {
    const listed =
      roles.length > 0
        ? roles.filter((r) => r.permissions.every((code) => can(code)))
        : STAFF_ROLES.map((code) => ({ code, name: code, system: true, permissions: [], assignedCount: 0 }));
    return listed.length > 0 ? listed : [{ code: "STAFF", name: "STAFF", system: true, permissions: [], assignedCount: 0 }];
  }, [roles, can]);

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
        full_name:  fullName,
        department: department || undefined,
        phone:      buildPhone(),
        notes:      notes || null,
        // Pay is sent only by someone who may set it — the API refuses it otherwise.
        ...(canSalary && {
          salary_minor: toMinor(salary),
          currency:     currency || undefined,
        }),
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

      {/* ── Who ───────────────────────────────────────────────────────────── */}
      <Section icon={User} title={t("form.sectionProfile")} description={t("form.sectionProfileDesc")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      </Section>

      {/* ── Sign-in and role (add only) ───────────────────────────────────── */}
      {!isEditing && (
        <Section icon={ShieldCheck} title={t("form.sectionAccount")} description={t("form.sectionAccountDesc")}>
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <Field label={t("form.role")} hint={t("form.roleHint")}>
                <RolePicker roles={roleList} areas={areas} value={role} onChange={setRole} />
              </Field>

              {can("role.manage") && (
                <p className="text-muted-foreground text-xs">
                  {t("form.manageRolesHint")}{" "}
                  <Link href="/staff?tab=roles" className="text-primary font-medium underline">
                    {t("form.manageRolesLink")}
                  </Link>
                </p>
              )}
            </>
          )}
        </Section>
      )}

      {/* ── Optional details ──────────────────────────────────────────────── */}
      <section className="rounded-2xl border bg-card/40">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
          className="flex w-full items-center justify-between gap-3 p-4 text-start sm:px-5"
          data-testid="staff-details-toggle"
        >
          <span className="flex items-center gap-3">
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
              <FileText className="size-4.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{t("form.sectionDetails")}</span>
              <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
                {canSalary ? t("form.sectionDetailsDesc") : t("form.sectionDetailsDescNoPay")}
              </span>
            </span>
          </span>
          <ChevronDown
            className={cn("text-muted-foreground size-4 shrink-0 transition-transform", detailsOpen && "rotate-180")}
            aria-hidden
          />
        </button>

        {detailsOpen && (
          <div className="space-y-4 border-t p-4 sm:p-5">
            <Field label={t("form.department")} hint={t("form.departmentHint")}>
              <Combobox
                options={departmentOptions}
                value={department}
                onChange={setDepartment}
                placeholder={t("form.departmentPlaceholder")}
                searchPlaceholder={t("form.searchDepartment")}
                data-testid="department-select"
              />
            </Field>

            <Field label={t("form.notes")}>
              <textarea
                aria-label={t("form.notes")}
                rows={2}
                placeholder={t("form.notesPlaceholder")}
                className={cn(inputBase, "resize-none px-3.5 py-2.5")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>

            {canSalary && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="staff-salary-fields">
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
            )}
          </div>
        )}
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="bg-card sticky bottom-0 -mx-1 flex justify-end gap-2 border-t px-1 pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("back")}
        </Button>
        <Button type="submit" size="sm" disabled={busy} className="gap-1.5" data-testid="staff-submit">
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
