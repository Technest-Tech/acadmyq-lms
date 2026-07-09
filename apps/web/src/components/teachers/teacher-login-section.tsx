"use client";

import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, type TeacherLogin, updateTeacherLogin } from "@/lib/api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The teacher's sign-in login (email + password). When the teacher has no login yet this creates
 * one (both fields required); otherwise it changes the email and/or resets the password directly.
 * Gated by teacher.update (the server Gate is the real control; creating also needs invite/role caps).
 */
export function TeacherLoginSection({
  teacherId,
  login,
  onChanged,
}: {
  teacherId: string;
  login: TeacherLogin;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("teachers.account");
  const { can } = useAuth();

  const [email, setEmail] = useState(login.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{
    variant: "success" | "error";
    text: string;
  } | null>(null);

  if (!can("teacher.update")) return null;

  const creating = !login.has_login;
  const emailTrim = email.trim().toLowerCase();
  const emailChanged = emailTrim !== (login.email ?? "").toLowerCase();
  const emailValid = EMAIL_RE.test(emailTrim);
  const passwordValid = password.length === 0 || password.length >= 8;

  // Creating requires both fields; editing requires at least one valid change.
  const canSave = creating
    ? !busy && emailValid && password.length >= 8
    : !busy && (emailChanged || password.length > 0) && emailValid && passwordValid;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setMsg(null);
    try {
      const patch: { email?: string; password?: string } = {};
      if (creating || emailChanged) patch.email = emailTrim;
      if (password.length > 0) patch.password = password;
      const res = await updateTeacherLogin(teacherId, patch);
      setMsg({
        variant: "success",
        text: t(res.created ? "created" : "updated"),
      });
      setPassword("");
      await onChanged();
    } catch (err) {
      setMsg({
        variant: "error",
        text: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4" data-testid="teacher-account">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {t("title")}
      </p>

      <div className="flex items-start gap-2.5 rounded-xl border bg-muted/20 p-3.5">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <p className="text-muted-foreground text-xs">
          {creating ? t("createHint") : t("hint")}
        </p>
      </div>

      {msg && (
        <AlertBanner
          variant={msg.variant}
          message={msg.text}
          onDismiss={() => setMsg(null)}
        />
      )}

      <form className="space-y-3" onSubmit={submit}>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("email")}
          </span>
          <input
            type="email"
            dir="ltr"
            autoComplete="off"
            aria-label={t("email")}
            className={inputClass}
            placeholder="teacher@example.com"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {creating ? t("password") : t("newPassword")}
          </span>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              dir="ltr"
              autoComplete="new-password"
              aria-label={creating ? t("password") : t("newPassword")}
              className={cn(inputClass, "pe-10")}
              placeholder={t("passwordPlaceholder")}
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={t(showPassword ? "hidePassword" : "showPassword")}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-0 flex items-center pe-3"
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
          </div>
          <span className="text-[11px] text-muted-foreground/70">
            {t("passwordHint")}
          </span>
        </label>

        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={!canSave}
            data-testid="save-teacher-login"
            className="gap-1.5"
          >
            <KeyRound className="size-3.5" />
            {busy ? t("saving") : creating ? t("create") : t("save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
