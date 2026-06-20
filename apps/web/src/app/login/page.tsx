"use client";

import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { ApiError, login } from "@/lib/api";

/**
 * The login screen (Sprint 2 §6.1). Public, outside the authenticated shell.
 * Premium split-screen layout: an immersive branded panel on the left (desktop)
 * and a clean, focused sign-in form on the right. On success the Sanctum session
 * cookie is set and we route to "/" — the shell decides what to render per role.
 */
export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace("/dashboard");
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

  const features = [
    t("login.feature1"),
    t("login.feature2"),
    t("login.feature3"),
  ];

  return (
    <div className="bg-background flex min-h-dvh">
      {/* Left: immersive branded panel — visible lg+ only */}
      <div className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex lg:w-[44%] xl:w-[42%]">
        {/* Base gradient */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(155deg, oklch(0.16 0.03 250) 0%, oklch(0.19 0.05 200) 45%, oklch(0.21 0.08 163) 100%)",
          }}
        />
        {/* Glow orbs */}
        <div
          className="pointer-events-none absolute -top-32 -end-24 size-96 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.55 0.16 163), transparent 70%)",
          }}
        />
        <div
          className="pointer-events-none absolute -bottom-40 -start-24 size-[28rem] rounded-full opacity-25 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.7 0.13 85), transparent 70%)",
          }}
        />
        {/* Dot-grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
            backgroundSize: "30px 30px",
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt={t("app.name")}
            className="size-10 rounded-xl bg-white/10 object-contain p-1 ring-1 ring-white/15 backdrop-blur-sm"
          />
          <span className="text-lg font-bold tracking-tight">
            {t("app.name")}
          </span>
        </div>

        {/* Centre copy */}
        <div className="relative max-w-md space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-bold leading-[1.15] tracking-tight">
              {t("app.tagline")}
            </h2>
            <p className="text-base leading-relaxed text-white/60">
              {t("login.heroSubtitle")}
            </p>
          </div>

          <ul className="space-y-3.5">
            {features.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-3 text-sm text-white/85"
              >
                <span className="bg-gold/20 ring-gold/30 flex size-5 shrink-0 items-center justify-center rounded-full ring-1">
                  <Check className="text-gold size-3" aria-hidden />
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between text-xs text-white/40">
          <span>{t("login.trustedBy")}</span>
          <span>© 2025 {t("app.name")}</span>
        </div>
      </div>

      {/* Right: form panel */}
      <div className="flex flex-1 flex-col">
        <div className="flex justify-end p-5">
          <LocaleSwitcher />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-16 sm:px-10">
          <div className="animate-page-enter w-full max-w-[400px] space-y-8">
            {/* Mobile/tablet logo (left panel hidden below lg) */}
            <div className="flex items-center gap-2.5 lg:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt={t("app.name")}
                className="size-9 shrink-0 object-contain"
              />
              <span className="text-lg font-bold tracking-tight">
                {t("app.name")}
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">
                {t("auth.welcomeBack")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t("auth.signInSubtitle")}
              </p>
            </div>

            <form className="space-y-5" onSubmit={onSubmit} noValidate>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  {t("auth.email")}
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
                    placeholder={t("auth.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="border-input bg-background placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/15 h-11 w-full rounded-xl border ps-10 pe-3.5 text-sm shadow-xs outline-none transition-colors focus:ring-3"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  {t("auth.password")}
                </label>
                <div className="relative">
                  <Lock
                    className="text-muted-foreground/70 pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2"
                    aria-hidden
                  />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    placeholder={t("auth.passwordPlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-input bg-background placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/15 h-11 w-full rounded-xl border ps-10 pe-11 text-sm shadow-xs outline-none transition-colors focus:ring-3"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={
                      showPassword
                        ? t("auth.hidePassword")
                        : t("auth.showPassword")
                    }
                    className="text-muted-foreground/70 hover:text-foreground focus-visible:ring-ring/50 absolute end-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="border-destructive/25 bg-destructive/8 rounded-xl border px-3.5 py-3"
                >
                  <p className="text-destructive text-sm">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="group/submit h-11 w-full rounded-xl text-sm font-semibold shadow-sm"
                disabled={submitting}
              >
                {submitting ? (
                  t("auth.signingIn")
                ) : (
                  <>
                    {t("auth.signIn")}
                    <ArrowRight className="size-4 transition-transform group-hover/submit:translate-x-0.5 rtl:rotate-180 rtl:group-hover/submit:-translate-x-0.5" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
