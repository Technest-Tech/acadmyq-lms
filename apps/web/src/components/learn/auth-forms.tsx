"use client";

import { Eye, EyeOff, Loader2, Ticket } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { AlertBanner } from "@/components/ui/alert";
import {
  learnLogin,
  learnRedeem,
  learnRegister,
  LearnApiError,
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
 *
 * Two things these deliberately do NOT do:
 *
 *  - they do not label fields with placeholders alone. A placeholder disappears the moment you type,
 *    so the one moment a form is hardest to read is the moment it stops saying what each box is for;
 *  - they do not print whatever the API said. A raw framework validation message ("The email field
 *    must be a valid email address.") is untranslated, unstyled and written for a developer. Errors
 *    are mapped to the visitor's language by STATUS, with the generic message as the floor.
 */

export const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-xl border px-3.5 text-sm outline-none transition-shadow focus-visible:ring-4";

export const submitClass =
  "bg-primary text-primary-foreground focus-visible:ring-ring/60 focus-visible:ring-offset-background inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-all hover:brightness-[1.06] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60";

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
      <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-24">
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

/** A labelled field. The label is always visible — it is what the box is, not a hint. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/**
 * A password box with a reveal toggle. Typing a password blind on a phone keyboard is the single
 * most common reason a sign-in fails twice in a row.
 */
function PasswordField({
  id,
  label,
  hint,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const t = useTranslations("learn");
  const [shown, setShown] = useState(false);

  return (
    <Field id={id} label={label} hint={hint}>
      <div className="relative">
        <input
          id={id}
          className={cn(fieldClass, "pe-11")}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={8}
          required
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t("auth.hidePassword") : t("auth.showPassword")}
          aria-pressed={shown}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 absolute end-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {shown ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
    </Field>
  );
}

/** Sign-in / registration, switchable in place. `onDone` fires once a token is stored. */
export function AuthForm({
  academy,
  mode,
  onModeChange,
  onDone,
  /** What the visitor was about to do — shown above the form so the detour makes sense. */
  intent,
}: {
  academy: string;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onDone: (learner: LearnProfile) => void;
  intent?: string;
}) {
  const t = useTranslations("learn");
  const ids = useId();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Turn whatever came back into something a student can act on. 401/422 mean "these details are
   * wrong" — the only thing the visitor can do about it — and everything else is ours, not theirs.
   */
  function messageFor(e: unknown): string {
    const status = e instanceof LearnApiError ? e.status : 0;
    if (status === 401 || status === 403 || status === 422) {
      return mode === "login" ? t("auth.loginFailed") : t("auth.registerFailed");
    }
    return t("errors.generic");
  }

  async function submit() {
    // Checked before the request so the answer is instant and in the visitor's language, rather
    // than a round-trip that comes back as a server-side validation string.
    if (mode === "register" && fullName.trim() === "") {
      setError(t("auth.nameRequired"));
      return;
    }
    if (!/.+@.+\..+/.test(email.trim())) {
      setError(t("auth.emailRequired"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordShort"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await learnLogin(academy, { email: email.trim(), password })
          : await learnRegister(academy, {
              full_name: fullName.trim(),
              email: email.trim(),
              password,
              ...(phone.trim() ? { phone: phone.trim() } : {}),
            });
      setLearnToken(academy, res.token);
      onDone(res.learner);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {intent && (
        <p className="bg-muted/60 text-muted-foreground rounded-xl px-3.5 py-2.5 text-sm">
          {intent}
        </p>
      )}
      {error && <AlertBanner variant="error" message={error} />}

      {mode === "register" && (
        <Field id={`${ids}-name`} label={t("auth.fullName")}>
          <input
            id={`${ids}-name`}
            className={fieldClass}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
          />
        </Field>
      )}

      <Field id={`${ids}-email`} label={t("auth.email")}>
        <input
          id={`${ids}-email`}
          className={fieldClass}
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </Field>

      {mode === "register" && (
        <Field id={`${ids}-phone`} label={t("auth.phone")}>
          <input
            id={`${ids}-phone`}
            className={fieldClass}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </Field>
      )}

      <PasswordField
        id={`${ids}-password`}
        label={t("auth.password")}
        hint={mode === "register" ? t("auth.passwordHint") : undefined}
        value={password}
        onChange={setPassword}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />

      <button type="submit" className={submitClass} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {mode === "login" ? t("auth.signIn") : t("auth.register")}
      </button>

      {/* Only on sign-in: on the register form it would read as an odd thing to offer someone who
          has no account yet. */}
      {mode === "login" && (
        <Link
          href={`/learn/${academy}/forgot-password`}
          className="text-muted-foreground hover:text-foreground block rounded text-center text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {t("forgot.link")}
        </Link>
      )}

      {/* The switch is a sentence with a real link in it, not a grey line of text that happens to
          be clickable — the two accounts of "I'm new" and "I'm back" are the fork of this screen. */}
      <p className="border-t pt-4 text-center text-sm">
        <span className="text-muted-foreground">
          {mode === "login" ? t("auth.newHere") : t("auth.already")}
        </span>{" "}
        <button
          type="button"
          className="text-primary rounded font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
          onClick={() => {
            onModeChange(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? t("auth.createOne") : t("auth.signInInstead")}
        </button>
      </p>
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
  const id = useId();
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
      // A redeem failure IS the message — "this code was already used", "no such code" — and the
      // API writes those for the learner, so it is the one place a server string belongs.
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
      <Field id={id} label={t("redeem.title")}>
        <input
          id={id}
          className={cn(fieldClass, "text-center font-mono text-base tracking-[0.25em] uppercase")}
          placeholder="XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      </Field>
      <button type="submit" className={submitClass} disabled={busy || !code.trim()}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t("redeem.submit")}
      </button>
    </form>
  );
}
