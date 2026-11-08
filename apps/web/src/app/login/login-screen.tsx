"use client";

import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthCard, authInputClass } from "@/components/auth/auth-card";
import { ctaClass } from "@/components/marketing/ui";
import { ApiError, getMe, login } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The sign-in card (Sprint 2 §6.1). The page around it — the navy ground, the header or the
 * client's language switch, the help line — is `AuthFrame`; this is only the card: who the door
 * belongs to, and the two fields.
 *
 *  - THE PLATFORM door (`brand` absent): our mark, "Sign in", one line under it.
 *  - A CLIENT's door (`brand` present, docs/lms/02): their logo (or initials) and their name. The
 *    attempt carries their handle, so the door only opens for that client's own people.
 *
 * Two things this card does to make ONE sign-in always enough (people were signing in twice):
 *
 *  1. The button stays busy after a successful sign-in until the dashboard actually replaces this
 *     page. It used to re-enable the moment the API answered, while the route change to the
 *     dashboard was still loading — on a slow line that is seconds of an idle form, and people
 *     reasonably pressed it again. The dashboard is prefetched on mount so the hop is short, and
 *     if the client-side hop has not happened after a few seconds a full page load finishes it.
 *  2. A visitor who already has a live session (including one who just signed in and was bounced
 *     back by a slow first load of the panel) is sent straight in instead of shown the form again.
 */

export interface LoginBrand {
  /** The subdomain handle this door belongs to; posted with the attempt. */
  handle: string;
  /** The client's display name (brand name if they set one, else the academy name). */
  name: string;
  logoUrl: string | null;
}

/** How long a successful sign-in waits on the client-side route change before forcing a load. */
const HARD_NAV_AFTER_MS = 6000;

export function LoginScreen({ brand }: { brand?: LoginBrand | null }) {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Warm the dashboard's route so the hop after a sign-in is short, and send anyone who already
  // has a session straight in — the form paints meanwhile, and a valid session simply replaces it.
  useEffect(() => {
    router.prefetch?.("/dashboard");
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
  }, [router]);

  useEffect(
    () => () => {
      if (fallback.current) clearTimeout(fallback.current);
    },
    [],
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, brand?.handle);
    } catch (err) {
      setSubmitting(false);
      setError(errorMessage(err));
      return;
    }

    // Signed in. Stay busy until the dashboard takes over (see the note at the top).
    router.replace("/dashboard");
    fallback.current = setTimeout(() => {
      window.location.assign("/dashboard");
    }, HARD_NAV_AFTER_MS);
  }

  function errorMessage(err: unknown): string {
    // Bad credentials (422), inactive (403) and "not this academy" (422) all collapse to one
    // neutral message, so we never reveal whether an account exists — or where it belongs.
    // The refusals the server NAMES (a suspended academy, a switched-off role, no role at all)
    // are different: the password was right, and "wrong password" would send the person off to
    // reset a password that works. A 419 that survived the CSRF retry, a 429 and any 5xx are not
    // about the password either, so they say "try again", never "wrong password".
    if (!(err instanceof ApiError)) return t("auth.serverError");
    if (err.status >= 500 || err.status === 419 || err.status === 429) {
      return t("auth.serverError");
    }
    const code =
      err.status === 403
        ? (err.body as { code?: string } | undefined)?.code
        : undefined;
    if (code === "academy_suspended") return t("auth.academySuspended");
    if (code === "role_inactive") return t("auth.roleInactive");
    if (code === "no_role") return t("auth.noRole");
    return t("auth.invalidCredentials");
  }

  const initials = brand
    ? brand.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase()
    : "";

  return (
    <AuthCard>
      <div className="mb-7 flex flex-col items-center text-center">
        {brand ? (
          brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={brand.name}
              className="ring-gold/40 size-16 rounded-2xl bg-white object-contain p-1.5 shadow-md ring-1"
            />
          ) : (
            <span
              aria-hidden
              className="bg-ink text-gold ring-gold/40 flex size-16 items-center justify-center rounded-2xl text-xl font-extrabold shadow-md ring-1"
            >
              {initials || "✦"}
            </span>
          )
        ) : (
          <Image src="/logo.png" alt="" width={512} height={394} className="h-11 w-auto" priority />
        )}

        <h1 className="mt-5 text-2xl font-extrabold">
          {brand ? brand.name : t("auth.signIn")}
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {brand ? t("login.cardSubtitle") : t("auth.signInSubtitle")}
        </p>
      </div>

      <form className="space-y-5" onSubmit={onSubmit} noValidate>
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-bold">
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
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder={t("auth.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(authInputClass, "ps-10 pe-3.5")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="password" className="text-sm font-bold">
              {t("auth.password")}
            </label>
            <Link
              href="/forgot-password"
              className="text-primary text-xs font-bold underline-offset-4 hover:underline"
            >
              {t("auth.forgotPassword")}
            </Link>
          </div>
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
              className={cn(authInputClass, "ps-10 pe-11")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
              className="text-muted-foreground/70 hover:text-foreground focus-visible:ring-ring/50 absolute end-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2"
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
          className={cn(ctaClass.primary, "group/submit w-full disabled:opacity-70")}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("auth.signingIn")}
            </>
          ) : (
            <>
              {t("auth.signIn")}
              <ArrowRight
                className="size-4 transition-transform group-hover/submit:translate-x-0.5 rtl:rotate-180 rtl:group-hover/submit:-translate-x-0.5"
                aria-hidden
              />
            </>
          )}
        </button>
      </form>
    </AuthCard>
  );
}

export default LoginScreen;
