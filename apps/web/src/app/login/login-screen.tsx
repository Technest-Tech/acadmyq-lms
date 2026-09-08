"use client";

import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ArchPanel, KhatamLattice, StarDivider } from "@/components/ornaments";
import {
  CheckItem,
  Container,
  ctaClass,
  Eyebrow,
} from "@/components/marketing/ui";
import { ApiError, getMe, login } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The sign-in screen (Sprint 2 §6.1) — one screen serving two doors, in two deliberately different
 * layouts:
 *
 *  - THE PLATFORM door (`app.<root>/login`, `brand` absent): the last page of the marketing site.
 *    It is rendered INSIDE that site's chrome (see page.tsx) and built from its kit — the same
 *    Container, Eyebrow, CheckItem and CTA shape as the homepage — because someone arriving from
 *    "Log in" in the site header should not feel handed off to a different product. What it
 *    replaced was a dark split-screen with blurred glow orbs and a dot grid, a look the marketing
 *    site does not use anywhere: one soft radial wash is the only ambient treatment on this site,
 *    and this page now uses that one.
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

  // The marketing kit's note applies here too: a landing page wants 48px targets and wider radii,
  // and this door is one of its pages now. The client door below inherits the same controls, which
  // is right — the two doors differ in what surrounds the form, never in the form itself.
  const inputClass =
    "border-input bg-background placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/15 h-12 w-full rounded-xl border text-base shadow-xs outline-none transition-colors focus:ring-3 sm:text-sm";

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

      <button
        type="submit"
        className={cn(ctaClass.primary, "group/submit w-full disabled:opacity-60")}
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
      </button>
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

  // ── The platform door ──────────────────────────────────────────────────────
  // A marketing-site page, not a product screen. It sits inside SiteHeader/SiteFooter (page.tsx),
  // so it owns no chrome of its own: no logo lockup (the header carries it), no locale switcher
  // (the header carries it), no copyright line (the footer carries it). What is left is the one
  // thing this page is for — the pitch on one side, the form on the other.
  return (
    <section className="relative overflow-hidden">
      {/* The site's single ambient treatment, reused verbatim from the homepage hero. It lifts the
          headline off the paper ground and does nothing else; the orbs and dot-grid this replaced
          were decoration competing with the one action on the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(70%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_70%)]"
      />

      <Container className="relative py-14 sm:py-20 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_25rem] lg:gap-16">
          {/* The pitch. Ordered SECOND on mobile: a visitor who tapped "Log in" wants the form
              first, and reading three feature lines before reaching it is the phone version of
              the split-screen's problem. */}
          <div className="order-2 max-w-xl lg:order-1">
            <Eyebrow>{t("app.tagline")}</Eyebrow>
            <h1 className="mt-3 text-4xl font-bold text-balance sm:text-5xl">
              {t("auth.welcomeBack")}
            </h1>
            <p className="text-muted-foreground mt-5 text-lg leading-relaxed text-pretty">
              {t("login.heroSubtitle")}
            </p>
            <ul className="mt-8 space-y-3.5">
              {features.map((feature) => (
                <CheckItem key={feature}>{feature}</CheckItem>
              ))}
            </ul>
          </div>

          {/* The form. A plain card on the site's own paper — the same border, radius and shadow
              every other panel on the site wears. */}
          <div className="order-1 w-full lg:order-2 lg:justify-self-end">
            <div className="animate-page-enter bg-card border-border rounded-2xl border p-6 shadow-sm sm:p-8">
              <div className="mb-6 space-y-1.5">
                <h2 className="text-xl font-bold">{t("auth.signIn")}</h2>
                <p className="text-muted-foreground text-sm">
                  {t("auth.signInSubtitle")}
                </p>
              </div>
              {form}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

export default LoginScreen;
