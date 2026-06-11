"use client";

import { GraduationCap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { ApiError, login } from "@/lib/api";

/**
 * The login screen (Sprint 2 §6.1). Public, outside the authenticated shell. Split-screen
 * layout: branded left panel (desktop) + clean form right. On success the Sanctum session
 * cookie is set and we route to "/" — the shell decides what to render per role.
 */
export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace("/");
    } catch (err) {
      // Both bad credentials (422) and inactive (403) collapse to one neutral message,
      // so we never reveal whether an account exists.
      setError(
        err instanceof ApiError && err.status >= 500
          ? t("auth.serverError")
          : t("auth.invalidCredentials"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh">
      {/* Left: branded panel — visible md+ only */}
      <div
        className="relative hidden flex-col justify-between p-10 md:flex md:w-[400px] lg:w-[460px]"
        style={{
          background:
            "linear-gradient(160deg, oklch(0.148 0.025 250), oklch(0.17 0.07 163))",
        }}
      >
        {/* Subtle dot-grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="bg-primary/25 flex size-9 items-center justify-center rounded-xl">
            <GraduationCap className="text-primary size-5" aria-hidden />
          </div>
          <span className="text-lg font-bold text-white">{t("app.name")}</span>
        </div>

        {/* Centre copy */}
        <div className="relative space-y-3">
          <h2 className="text-3xl font-bold leading-snug text-white">
            {t("app.tagline")}
          </h2>
          <p className="text-sm text-white/50">
            Manage students, teachers, schedules, and billing — all in one
            place.
          </p>
        </div>

        <p className="relative text-xs text-white/25">© 2025 Academiq</p>
      </div>

      {/* Right: form panel */}
      <div className="bg-card flex flex-1 flex-col">
        <div className="flex justify-end p-4">
          <LocaleSwitcher />
        </div>

        <div className="flex flex-1 items-center justify-center px-8 pb-12">
          <div className="w-full max-w-[360px] space-y-7">
            {/* Mobile-only logo */}
            <div className="flex items-center gap-2 md:hidden">
              <div className="bg-primary/10 flex size-8 items-center justify-center rounded-lg">
                <GraduationCap className="text-primary size-4" aria-hidden />
              </div>
              <span className="font-semibold">{t("app.name")}</span>
            </div>

            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t("auth.signIn")}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("app.tagline")}
              </p>
            </div>

            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  {t("auth.email")}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium">
                  {t("auth.password")}
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3"
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="border-destructive/25 bg-destructive/8 rounded-lg border px-3.5 py-2.5"
                >
                  <p className="text-destructive text-sm">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                className="h-10 w-full text-sm font-semibold"
                disabled={submitting}
              >
                {submitting ? t("auth.signingIn") : t("auth.signIn")}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
