"use client";

import { Loader2, Ticket } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { AlertBanner } from "@/components/ui/alert";
import {
  learnLogin,
  learnRedeem,
  learnRegister,
  setLearnToken,
  type LearnProfile,
} from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The three learner forms — sign in, register, redeem a code — as standalone pieces (docs/lms/09).
 *
 * Each is used TWICE: inside the header's modal (fast path, keeps the visitor on the page they were
 * reading) and as the body of a real `/login`, `/register`, `/redeem` page (linkable, shareable, and
 * what a teacher hands to a student). They live here so the two never drift apart.
 */

export const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-xl border px-3.5 text-sm outline-none transition-shadow focus-visible:ring-4";

export const submitClass =
  "bg-primary text-primary-foreground inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-all hover:opacity-90 disabled:pointer-events-none disabled:opacity-60";

export type AuthMode = "login" | "register";

/** The centred card the standalone `/login`, `/register` and `/redeem` pages are built on. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate">
      <div
        className="absolute inset-x-0 top-0 -z-10 h-64"
        style={{ background: "linear-gradient(180deg, var(--brand-soft), transparent)" }}
        aria-hidden
      />
      <div className="mx-auto w-full max-w-md px-4 py-16 sm:py-24">
        <div className="bg-card rounded-3xl border p-7 shadow-sm sm:p-8">
          <div className="mb-6 space-y-1.5 text-center">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Sign-in / registration, switchable in place. `onDone` fires once a token is stored. */
export function AuthForm({
  academy,
  mode,
  onModeChange,
  onDone,
}: {
  academy: string;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onDone: (learner: LearnProfile) => void;
}) {
  const t = useTranslations("learn");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await learnLogin(academy, { email, password })
          : await learnRegister(academy, {
              full_name: fullName,
              email,
              password,
              ...(phone.trim() ? { phone: phone.trim() } : {}),
            });
      setLearnToken(academy, res.token);
      onDone(res.learner);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error && <AlertBanner variant="error" message={error} />}

      {mode === "register" && (
        <input
          className={fieldClass}
          placeholder={t("auth.fullName")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          required
        />
      )}
      <input
        className={fieldClass}
        type="email"
        placeholder={t("auth.email")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
      />
      {mode === "register" && (
        <input
          className={fieldClass}
          type="tel"
          placeholder={t("auth.phone")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
      )}
      <input
        className={fieldClass}
        type="password"
        placeholder={t("auth.password")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        minLength={8}
        required
      />

      <button type="submit" className={submitClass} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {mode === "login" ? t("auth.signIn") : t("auth.register")}
      </button>

      <button
        type="button"
        className="text-muted-foreground hover:text-foreground w-full text-center text-sm transition-colors"
        onClick={() => {
          onModeChange(mode === "login" ? "register" : "login");
          setError(null);
        }}
      >
        {mode === "login" ? t("auth.needAccount") : t("auth.haveAccount")}
      </button>
    </form>
  );
}

/**
 * Code redemption. On success it lists what was unlocked rather than closing silently — the code is
 * the moment the student paid for, and "it worked, here is your course" is the whole reassurance.
 */
export function RedeemForm({
  academy,
  onDone,
  doneLabel,
}: {
  academy: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  const t = useTranslations("learn");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<string[] | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await learnRedeem(academy, code.trim());
      setUnlocked(res.courses.map((c) => c.title));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) {
    return (
      <div className="space-y-4">
        <AlertBanner variant="success" message={t("redeem.unlocked")} />
        <ul className="space-y-1.5">
          {unlocked.map((title) => (
            <li
              key={title}
              className="border-border/70 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
            >
              <Ticket className="text-primary size-4 shrink-0" aria-hidden />
              {title}
            </li>
          ))}
        </ul>
        <button type="button" className={submitClass} onClick={onDone}>
          {doneLabel ?? t("redeem.done")}
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error && <AlertBanner variant="error" message={error} />}
      <p className="text-muted-foreground text-sm">{t("redeem.hint")}</p>
      <input
        className={cn(fieldClass, "text-center font-mono text-base tracking-[0.25em] uppercase")}
        placeholder="XXXX-XXXX"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
        required
      />
      <button type="submit" className={submitClass} disabled={busy || !code.trim()}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t("redeem.submit")}
      </button>
    </form>
  );
}
