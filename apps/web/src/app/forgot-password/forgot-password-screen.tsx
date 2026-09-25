"use client";

import { ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ctaClass } from "@/components/marketing/ui";
import { ApiError, forgotPassword } from "@/lib/api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/15 h-12 w-full rounded-xl border text-base shadow-xs outline-none transition-colors focus:ring-3 sm:text-sm";

/**
 * Request a password-reset link. The answer is the same whatever the email — the server never
 * says whether an address has an account — so the "sent" state is worded as a maybe.
 */
export function ForgotPasswordScreen() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : t("serverError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border-border rounded-2xl border p-6 shadow-sm sm:p-8" data-testid="forgot-password">
      <div className="mb-6 space-y-1.5">
        <h1 className="text-xl font-bold">{t("forgotTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("forgotSubtitle")}</p>
      </div>

      {sent ? (
        <div className="space-y-5">
          <div role="status" className="border-primary/25 bg-primary/8 rounded-xl border px-3.5 py-3">
            <p className="text-sm">{t("resetLinkSent")}</p>
          </div>
          <Link href="/login" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
            {t("backToLogin")}
          </Link>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={onSubmit} noValidate>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              {t("email")}
            </label>
            <div className="relative">
              <Mail
                className="text-muted-foreground/70 pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2"
                aria-hidden
              />
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${inputClass} ps-10 pe-3.5`}
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="border-destructive/25 bg-destructive/8 rounded-xl border px-3.5 py-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            className={cn(ctaClass.primary, "group/submit w-full disabled:opacity-60")}
            disabled={busy || email.trim() === ""}
          >
            {busy ? (
              t("sending")
            ) : (
              <>
                {t("sendResetLink")}
                <ArrowRight className="size-4 transition-transform group-hover/submit:translate-x-0.5 rtl:rotate-180 rtl:group-hover/submit:-translate-x-0.5" />
              </>
            )}
          </button>

          <p className="text-center text-sm">
            <Link href="/login" className="text-primary font-medium underline-offset-4 hover:underline">
              {t("backToLogin")}
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
