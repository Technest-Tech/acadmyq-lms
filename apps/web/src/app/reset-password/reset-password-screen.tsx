"use client";

import { ArrowRight, Eye, EyeOff, Lock } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ctaClass } from "@/components/marketing/ui";
import { ApiError, resetPassword } from "@/lib/api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/15 h-12 w-full rounded-xl border text-base shadow-xs outline-none transition-colors focus:ring-3 sm:text-sm";

/** Consume a reset link: the token and email ride on the query string, the person types the rest. */
export function ResetPasswordScreen() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < 8;
  const canSave = !busy && password.length >= 8 && confirm === password && token !== "" && email !== "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setError(null);
    setBusy(true);
    try {
      await resetPassword({ email, token, password });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 422
          ? t("resetInvalid")
          : t("serverError"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border-border rounded-2xl border p-6 shadow-sm sm:p-8" data-testid="reset-password">
      <div className="mb-6 space-y-1.5">
        <h1 className="text-xl font-bold">{t("resetTitle")}</h1>
        {email && !done && (
          <p className="text-muted-foreground text-sm">{t("resetSubtitle", { email })}</p>
        )}
      </div>

      {done ? (
        <div className="space-y-5">
          <div role="status" className="border-primary/25 bg-primary/8 rounded-xl border px-3.5 py-3">
            <p className="text-sm">{t("resetDone")}</p>
          </div>
          <Link href="/login" className={cn(ctaClass.primary, "w-full")}>
            {t("signIn")}
          </Link>
        </div>
      ) : token === "" || email === "" ? (
        <div className="space-y-5">
          <div role="alert" className="border-destructive/25 bg-destructive/8 rounded-xl border px-3.5 py-3">
            <p className="text-destructive text-sm">{t("resetMissing")}</p>
          </div>
          <Link href="/forgot-password" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
            {t("forgotTitle")}
          </Link>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={onSubmit} noValidate>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("newPassword")}
            </label>
            <div className="relative">
              <Lock
                className="text-muted-foreground/70 pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2"
                aria-hidden
              />
              <input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} ps-10 pe-11`}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? t("hidePassword") : t("showPassword")}
                className="text-muted-foreground/70 hover:text-foreground focus-visible:ring-ring/50 absolute end-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2"
              >
                {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
            {tooShort && <p className="text-destructive text-xs">{t("passwordTooShort")}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm" className="text-sm font-medium">
              {t("confirmPassword")}
            </label>
            <div className="relative">
              <Lock
                className="text-muted-foreground/70 pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2"
                aria-hidden
              />
              <input
                id="confirm"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={`${inputClass} ps-10 pe-3.5`}
              />
            </div>
            {mismatch && <p className="text-destructive text-xs">{t("passwordMismatch")}</p>}
          </div>

          {error && (
            <div role="alert" className="border-destructive/25 bg-destructive/8 rounded-xl border px-3.5 py-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            className={cn(ctaClass.primary, "group/submit w-full disabled:opacity-60")}
            disabled={!canSave}
          >
            {busy ? (
              t("resetting")
            ) : (
              <>
                {t("resetPassword")}
                <ArrowRight className="size-4 transition-transform group-hover/submit:translate-x-0.5 rtl:rotate-180 rtl:group-hover/submit:-translate-x-0.5" />
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
