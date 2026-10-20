"use client";

import { Eye, EyeOff, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  type AcademyAdmin,
  ApiError,
  createAcademyAdmin,
  listAcademyAdmins,
  updateAcademyAdmin,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/** First validation message from a 422, else the error's own message. */
function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const errors = (err.body as { errors?: Record<string, string[]> } | undefined)?.errors;
    const first = errors ? Object.values(errors)[0]?.[0] : undefined;
    return first ?? err.message;
  }
  return String(err);
}

function PasswordInput({
  value,
  onChange,
  label,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  testId: string;
}) {
  const t = useTranslations("settings.admins");
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label className="text-muted-foreground mb-1.5 block text-xs font-medium">{label}</label>
      <div className="relative">
        <input
          type={shown ? "text" : "password"}
          className={cn(inputBase, "pe-10")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          data-testid={testId}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? t("hidePassword") : t("showPassword")}
          className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-0 flex w-10 items-center justify-center"
        >
          {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      <p className="text-muted-foreground/70 mt-1 text-[11px]">{t("passwordHint")}</p>
    </div>
  );
}

/**
 * Settings → Account & data → Admins: the academy's full-access logins. An admin adds another
 * (name, email, password), sets a new password for one, or switches one off. The API refuses
 * switching off yourself or the last active admin; the buttons mirror that.
 */
export function AdminsCard() {
  const t = useTranslations("settings.admins");
  const locale = useLocale();
  const toast = useToast();
  const [admins, setAdmins] = useState<AcademyAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [resetFor, setResetFor] = useState<AcademyAdmin | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    try {
      setAdmins((await listAcademyAdmins()).admins);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = admins?.filter((a) => a.isActive).length ?? 0;

  async function add() {
    setSaving(true);
    setFormError(null);
    try {
      await createAcademyAdmin({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      toast.success(t("added", { email: form.email.trim() }));
      setAdding(false);
      setForm({ full_name: "", email: "", password: "" });
      await load();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (!resetFor) return;
    setSaving(true);
    setFormError(null);
    try {
      await updateAcademyAdmin(resetFor.id, { password: newPassword });
      toast.success(t("passwordChanged", { email: resetFor.email }));
      setResetFor(null);
      setNewPassword("");
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function setActive(admin: AcademyAdmin, isActive: boolean) {
    setBusyId(admin.id);
    setError(null);
    try {
      await updateAcademyAdmin(admin.id, { is_active: isActive });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  const formValid =
    form.full_name.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email.trim()) && form.password.length >= 8;

  return (
    <SectionCard
      icon={ShieldCheck}
      title={t("cardTitle")}
      description={t("cardDesc")}
      iconClassName="bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/25"
      testId="admins-card"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {admins === null ? (
        <div className="flex items-center justify-center py-8">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y rounded-xl border">
            {admins.map((admin) => {
              const canSwitchOff = !admin.isYou && admin.isActive && activeCount > 1;
              return (
                <li
                  key={admin.id}
                  className={cn(
                    "flex flex-col gap-3 p-4 sm:flex-row sm:items-center",
                    !admin.isActive && "opacity-60",
                  )}
                  data-testid={`admin-row-${admin.email}`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                      {admin.fullName.trim().charAt(0).toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{admin.fullName}</span>
                        {admin.isYou && (
                          <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-semibold">
                            {t("you")}
                          </span>
                        )}
                        {!admin.isActive && (
                          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-semibold">
                            {t("off")}
                          </span>
                        )}
                      </p>
                      <p className="text-muted-foreground truncate text-xs" dir="ltr">
                        {admin.email}
                      </p>
                      <p className="text-muted-foreground/80 mt-0.5 text-[11px]">
                        {admin.lastLoginAt
                          ? t("lastLogin", {
                              when: new Date(admin.lastLoginAt).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }),
                            })
                          : t("neverLoggedIn")}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!admin.isYou && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFormError(null);
                          setNewPassword("");
                          setResetFor(admin);
                        }}
                      >
                        <KeyRound aria-hidden />
                        {t("resetPassword")}
                      </Button>
                    )}
                    {!admin.isYou &&
                      (admin.isActive ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={!canSwitchOff || busyId === admin.id}
                          onClick={() => void setActive(admin, false)}
                        >
                          {t("switchOff")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busyId === admin.id}
                          onClick={() => void setActive(admin, true)}
                        >
                          {t("switchOn")}
                        </Button>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs leading-relaxed">{t("fullAccessNote")}</p>
            <Button
              type="button"
              onClick={() => {
                setFormError(null);
                setAdding(true);
              }}
              data-testid="add-admin"
            >
              <UserPlus aria-hidden />
              {t("add")}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={adding}
        onClose={() => !saving && setAdding(false)}
        title={t("addTitle")}
        description={t("addDesc")}
        closeLabel={t("cancel")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAdding(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => void add()} disabled={!formValid || saving} data-testid="save-admin">
              {saving ? t("saving") : t("create")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {formError && <AlertBanner variant="error" message={formError} onDismiss={() => setFormError(null)} />}
          <div>
            <label className="text-muted-foreground mb-1.5 block text-xs font-medium">{t("name")}</label>
            <input
              className={inputBase}
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              maxLength={255}
              data-testid="admin-name"
            />
          </div>
          <div>
            <label className="text-muted-foreground mb-1.5 block text-xs font-medium">{t("email")}</label>
            <input
              type="email"
              dir="ltr"
              className={inputBase}
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              autoComplete="off"
              maxLength={255}
              data-testid="admin-email"
            />
          </div>
          <PasswordInput
            label={t("password")}
            value={form.password}
            onChange={(v) => setForm((f) => ({ ...f, password: v }))}
            testId="admin-password"
          />
        </div>
      </Modal>

      <Modal
        open={resetFor !== null}
        onClose={() => !saving && setResetFor(null)}
        title={t("resetTitle")}
        description={resetFor ? t("resetDesc", { email: resetFor.email }) : undefined}
        size="sm"
        closeLabel={t("cancel")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setResetFor(null)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => void resetPassword()} disabled={newPassword.length < 8 || saving}>
              {saving ? t("saving") : t("savePassword")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {formError && <AlertBanner variant="error" message={formError} onDismiss={() => setFormError(null)} />}
          <PasswordInput label={t("newPassword")} value={newPassword} onChange={setNewPassword} testId="admin-new-password" />
        </div>
      </Modal>
    </SectionCard>
  );
}
