"use client";

import { ArrowRight, Check, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { ApiError, getMe, login } from "@/lib/api";
import { ArchPanel, KhatamLattice, StarDivider } from "@/components/ornaments";

/**
 * The sign-in screen (Sprint 2 §6.1) — one screen serving two doors, in two deliberately different
 * layouts:
 *
 *  - THE PLATFORM door (`app.<root>/login`, `brand` absent): the immersive split-screen — a branded
 *    marketing panel on the left, the form on the right. It sells Acadmyq to whoever lands on it.
 *  - A CLIENT's door (`<handle>.<root>`, `brand` present, docs/lms/02): a single centred card
 *    carrying their logo and name. Nothing to sell here — the person already knows where they are
 *    and is only passing through, so the card says who this belongs to and gets out of the way.
 *    It wears Islamic geometric ornament (see components/ornaments) — a khatam lattice and a pointed arch
 *    in the system's emerald and gold — because these clients are Egyptian academies and their own
 *    door should feel like theirs, not like a SaaS form.
 *    It is LIGHT-only (`.client-door`, globals.css): the client's front door must look the same to
 *    everyone at that academy, not follow one staff member's dark-mode preference. The wrapper also
 *    restates `text-foreground` — `body` resolved its `color` from the ROOT palette, so a dark-mode
 *    staff member would otherwise inherit near-white text into this light card.
 *
 * On success the Sanctum session cookie is set and we route to the dashboard — the shell decides
 * what to render per role. On a client door the attempt also carries their handle, so the door only
 * opens for that client's own people.
 */

export interface LoginBrand {
  /** The subdomain handle this door belongs to; posted with the attempt. */
  handle: string;
  /** The client's display name (brand name if they set one, else the academy name). */
  name: string;
  logoUrl: string | null;
}

export function LoginScreen({ brand }: { brand?: LoginBrand | null }) {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A client's own address doubles as their front door, so people open it with a session already
  // live — send them straight in rather than showing a form they don't need. Only on a client door:
  // on the platform login the visitor asked for the form. The form paints meanwhile; a valid
  // session simply replaces it.
  useEffect(() => {
    if (!brand) return;
    let cancelled = false;
    getMe()
      .then(() => {
        if (!cancelled) router.replace("/dashboard");
      })
      .catch(() => {
        /* no session — stay on the form */
      });
    return () => {
      cancelled = true;
    };
  }, [brand, router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, brand?.handle);
      router.replace("/dashboard");
    } catch (err) {
      // Bad credentials (422), inactive (403) and "not this academy" (422) all collapse to one
      // neutral message, so we never reveal whether an account exists — or where it belongs.
      setError(
        err instanceof ApiError && err.status >= 500
          ? t("auth.serverError")
          : t("auth.invalidCredentials"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "border-input bg-background placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/15 h-11 w-full rounded-xl border text-sm shadow-xs outline-none transition-colors focus:ring-3";

  /** The credentials form itself — identical on both doors, so it lives in one place. */
  const form = (
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
            className={`${inputClass} ps-10 pe-3.5`}
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
            className={`${inputClass} ps-10 pe-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={
              showPassword ? t("auth.hidePassword") : t("auth.showPassword")
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
  );

  if (brand) {
    const initials = brand.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();

    return (
      <div className="client-door text-foreground relative flex min-h-dvh flex-col overflow-hidden">
        {/* Ambient ground: a warm ivory base lit by an emerald dawn from above and a gold glow from
            the corner, so the card sits on something with depth instead of flat grey. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70rem 38rem at 50% -14%, oklch(0.519 0.158 163.2 / 0.18), transparent 68%)," +
              "radial-gradient(52rem 30rem at 100% 104%, oklch(0.835 0.118 85 / 0.20), transparent 70%)," +
              "linear-gradient(180deg, oklch(0.992 0.008 95) 0%, oklch(0.975 0.012 150) 100%)",
          }}
        />
        {/* The khatam lattice, faded out towards the edges so it frames the card rather than tiling
            the whole viewport. */}
        <div
          className="text-primary pointer-events-none absolute inset-0 opacity-[0.10]"
          style={{
            maskImage:
              "radial-gradient(46rem 34rem at 50% 34%, black 30%, transparent 76%)",
            WebkitMaskImage:
              "radial-gradient(46rem 34rem at 50% 34%, black 30%, transparent 76%)",
          }}
        >
          <KhatamLattice id="door-lattice" size={84} className="size-full" />
        </div>

        <div className="relative flex justify-end p-5">
          <LocaleSwitcher />
        </div>

        <main className="relative flex flex-1 items-center justify-center px-6 pb-16">
          <div className="animate-page-enter w-full max-w-[26rem]">
            <div className="bg-card ring-primary/[0.06] overflow-hidden rounded-3xl border shadow-xl ring-1 shadow-emerald-950/[0.08]">
              {/* ── The doorway: who this belongs to, standing in a lit arch ── */}
              <div className="border-gold/25 relative border-b px-8 pt-9 pb-7 text-center">
                <div
                  className="text-primary pointer-events-none absolute inset-0 opacity-[0.16]"
                  style={{
                    maskImage:
                      "linear-gradient(180deg, black 8%, transparent 92%)",
                    WebkitMaskImage:
                      "linear-gradient(180deg, black 8%, transparent 92%)",
                  }}
                >
                  <KhatamLattice
                    id="door-band-lattice"
                    size={56}
                    className="size-full"
                  />
                </div>
                <ArchPanel className="text-primary pointer-events-none absolute start-1/2 top-4 h-[10.5rem] w-[10rem] -translate-x-1/2 rtl:translate-x-1/2" />

                <div className="relative flex flex-col items-center gap-4">
                  {brand.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={brand.logoUrl}
                      alt={brand.name}
                      className="ring-gold/30 size-16 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-md ring-1"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="from-primary/15 text-primary ring-gold/30 flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b to-white text-xl font-bold shadow-md ring-1"
                    >
                      {initials || "✦"}
                    </span>
                  )}

                  <div className="space-y-1.5">
                    <p className="text-gold-foreground/70 text-[0.7rem] font-semibold tracking-[0.2em] uppercase">
                      {t("auth.welcomeBack")}
                    </p>
                    <h1 className="text-xl font-bold tracking-tight">
                      {brand.name}
                    </h1>
                    <p className="text-muted-foreground text-sm">
                      {t("login.cardSubtitle")}
                    </p>
                  </div>

                  <StarDivider className="pt-0.5" />
                </div>
              </div>

              <div className="px-8 pt-7 pb-8 sm:px-9">{form}</div>
            </div>

            <p className="text-muted-foreground/70 mt-5 text-center text-xs">
              {t("login.poweredBy")}
            </p>
          </div>
        </main>
      </div>
    );
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

            {form}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;
