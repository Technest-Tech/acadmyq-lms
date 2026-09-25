"use client";

import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type AcademyRoleSummary,
  ApiError,
  listAcademyRoles,
  type StaffLogin,
  updateStaffLogin,
} from "@/lib/api";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Built-in roles the staff form may assign, weakest first. Mirrors StaffController. */
const BUILT_IN = ["STAFF", "SUPERVISOR"] as const;

/**
 * The employee's sign-in login on their detail page — the half of the staff module that was
 * missing. A login used to be create-only: once the form closed, its email was never shown again,
 * and nothing could change the password, move the person to another role or switch the login off.
 *
 * Gating mirrors the server: creating and re-issuing credentials (email / password / enabled) need
 * user.invite; changing the role needs role.assign. Someone with staff.update but neither sees the
 * login read-only.
 */
export function StaffLoginSection({
  staffId,
  login,
  isSelf,
  onChanged,
}: {
  staffId: string;
  login: StaffLogin;
  /** The signed-in user looking at their own login: no switching yourself off. */
  isSelf: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("staff.account");
  const tRoles = useTranslations("roles");
  const tAcademyRoles = useTranslations("academyRoles");
  const { can } = useAuth();

  const creating = !login.has_login;
  const canCredentials = can("user.invite");
  const canRole = can("role.assign");
  const canCreate = canCredentials && canRole;

  const [email, setEmail] = useState(login.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState(login.role ?? "STAFF");
  const [active, setActive] = useState(login.is_active ?? true);
  const [roles, setRoles] = useState<AcademyRoleSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ variant: "success" | "error"; text: string } | null>(null);

  // Keep the form in step with a reloaded login (after a save, or a parent refresh).
  useEffect(() => {
    setEmail(login.email ?? "");
    setRole(login.role ?? "STAFF");
    setActive(login.is_active ?? true);
    setPassword("");
  }, [login.email, login.role, login.is_active]);

  // The assignable roles: the two built-ins plus the academy's own active custom roles. Listing
  // needs role.manage; without it the built-ins (and whatever the person already holds) remain.
  useEffect(() => {
    if (!canRole) return;
    listAcademyRoles()
      .then((res) => {
        const builtIn = BUILT_IN.map((code) => res.system.find((r) => r.code === code)).filter(
          (r): r is AcademyRoleSummary => r !== undefined,
        );
        setRoles([...builtIn, ...res.custom.filter((r) => r.isActive !== false)]);
      })
      .catch(() => {});
  }, [canRole]);

  const roleOptions: Array<{ code: string; label: string }> = (() => {
    const base =
      roles.length > 0
        ? roles.map((r) => ({
            code: r.code,
            label: r.system ? tAcademyRoles(`role.${r.code}`) : r.name,
          }))
        : BUILT_IN.map((code) => ({ code, label: tAcademyRoles(`role.${code}`) }));
    // A role the person holds that is not on the list any more (deactivated, or one we may not
    // list) still has to display.
    if (login.role && !base.some((o) => o.code === login.role)) {
      base.push({ code: login.role, label: roleLabel(tRoles, login.role) });
    }
    return base;
  })();

  const emailTrim = email.trim().toLowerCase();
  const emailChanged = emailTrim !== (login.email ?? "").toLowerCase();
  const emailValid = EMAIL_RE.test(emailTrim);
  const passwordValid = password.length === 0 || password.length >= 8;
  const roleChanged = role !== (login.role ?? "STAFF");
  const activeChanged = active !== (login.is_active ?? true);

  const canSave = creating
    ? canCreate && !busy && emailValid && password.length >= 8
    : !busy &&
      emailValid &&
      passwordValid &&
      ((canCredentials && (emailChanged || password.length > 0 || activeChanged)) ||
        (canRole && roleChanged));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setMsg(null);
    try {
      const patch: { email?: string; password?: string; role?: string; is_active?: boolean } = {};
      if (creating) {
        patch.email = emailTrim;
        patch.password = password;
        patch.role = role;
      } else {
        if (canCredentials && emailChanged) patch.email = emailTrim;
        if (canCredentials && password.length > 0) patch.password = password;
        if (canCredentials && activeChanged && !isSelf) patch.is_active = active;
        if (canRole && roleChanged) patch.role = role;
      }
      const res = await updateStaffLogin(staffId, patch);
      setMsg({ variant: "success", text: t(res.created ? "created" : "updated") });
      setPassword("");
      await onChanged();
    } catch (err) {
      setMsg({ variant: "error", text: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  // Nothing to offer someone who can neither create nor change a login, and there is none.
  if (creating && !canCreate) return null;

  return (
    <section className="space-y-4 rounded-2xl border bg-card/40 p-4 sm:p-5" data-testid="staff-account">
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
          <KeyRound className="size-4.5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{t("title")}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
            {creating ? t("createHint") : t("hint")}
          </p>
        </div>
      </div>

      {isSelf && (
        <div className="flex items-start gap-2.5 rounded-xl border bg-muted/20 p-3.5">
          <ShieldCheck className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-muted-foreground text-xs">{t("self")}</p>
        </div>
      )}

      {msg && <AlertBanner variant={msg.variant} message={msg.text} onDismiss={() => setMsg(null)} />}

      <form className="space-y-3" onSubmit={submit}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">{t("email")}</span>
            <input
              type="email"
              dir="ltr"
              autoComplete="off"
              aria-label={t("email")}
              className={inputClass}
              placeholder="employee@example.com"
              value={email}
              disabled={busy || (!creating && !canCredentials)}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {creating ? t("password") : t("newPassword")}
            </span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                aria-label={creating ? t("password") : t("newPassword")}
                className={cn(inputClass, "pe-10")}
                placeholder={creating ? "" : t("passwordPlaceholder")}
                value={password}
                disabled={busy || (!creating && !canCredentials)}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={t(showPassword ? "hidePassword" : "showPassword")}
                className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-0 flex items-center pe-3"
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground/70">{t("passwordHint")}</span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">{t("role")}</span>
            <select
              aria-label={t("role")}
              className={inputClass}
              value={role}
              disabled={busy || !canRole}
              onChange={(e) => setRole(e.target.value)}
              data-testid="staff-login-role"
            >
              {roleOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {!creating && (
            <div className="flex items-center justify-between gap-4 rounded-xl border bg-background px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("active")}</p>
                <p className="text-muted-foreground text-xs">{t("activeHint")}</p>
              </div>
              <Switch
                checked={active}
                disabled={busy || !canCredentials || isSelf}
                onChange={(e) => setActive(e.target.checked)}
                aria-label={t("active")}
                data-testid="staff-login-active"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!canSave} data-testid="save-staff-login" className="gap-1.5">
            <KeyRound className="size-3.5" />
            {busy ? t("saving") : creating ? t("create") : t("save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
