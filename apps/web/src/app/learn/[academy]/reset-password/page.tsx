"use client";

import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState, type FormEvent } from "react";
import { AuthShell, fieldClass } from "@/components/learn/auth-forms";
import { useLearn, useLearnHref } from "@/components/learn/context";
import { AlertBanner } from "@/components/ui/alert";
import { learnResetPassword } from "@/lib/learn-api";

/**
 * The page the reset link opens (docs/lms/10 §2). The token rides in the query string, is spent
 * server-side, and every other live token for this learner dies with it — along with every session,
 * which is the point of a reset.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const t = useTranslations("learn");
  const href = useLearnHref();
  const { academy } = useLearn();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm !== "" && password !== confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await learnResetPassword(academy, {
        token,
        password,
        password_confirmation: confirm,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  if (token === "") {
    return (
      <AuthShell title={t("reset.title")}>
        <AlertBanner variant="error" message={t("reset.missingToken")} />
        <Link href={href("/forgot-password")} className="text-primary mt-4 block text-center text-sm font-semibold">
          {t("forgot.title")}
        </Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title={t("reset.doneTitle")}>
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
          <p className="text-muted-foreground text-sm">{t("reset.doneBody")}</p>
          <Link href={href("/login")} className="text-primary block text-sm font-semibold">
            {t("auth.signIn")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("reset.title")} subtitle={t("reset.subtitle")}>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <AlertBanner variant="error" message={error} />}
        <input
          className={fieldClass}
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder={t("reset.newPassword")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          className={fieldClass}
          type="password"
          required
          autoComplete="new-password"
          placeholder={t("reset.confirmPassword")}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <p className="text-destructive text-xs">{t("reset.mismatch")}</p>}
        <button
          type="submit"
          disabled={busy || password.length < 8 || mismatch}
          className="bg-primary text-primary-foreground inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <KeyRound className="size-4" aria-hidden />
          )}
          {t("reset.submit")}
        </button>
      </form>
    </AuthShell>
  );
}
