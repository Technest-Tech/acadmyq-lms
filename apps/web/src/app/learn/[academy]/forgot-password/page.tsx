"use client";

import { CheckCircle2, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { AuthShell, fieldClass } from "@/components/learn/auth-forms";
import { useLearn, useLearnHref } from "@/components/learn/context";
import { AlertBanner } from "@/components/ui/alert";
import { learnForgotPassword } from "@/lib/learn-api";

/**
 * "I forgot my password" (docs/lms/10 §2). The success screen is shown for ANY well-formed address,
 * including one that belongs to nobody: the API answers the same way either way, and a UI that
 * revealed the difference would hand anyone a way to test who this academy's students are.
 *
 * Delivery is WhatsApp when the learner left a number, email otherwise — so the confirmation says
 * "check your WhatsApp or your email" rather than promising one and sending the other.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations("learn");
  const href = useLearnHref();
  const { academy, siteName } = useLearn();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await learnForgotPassword(academy, email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title={t("forgot.sentTitle")} subtitle={t("forgot.sentSubtitle")}>
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
          <p className="text-muted-foreground text-sm leading-relaxed">{t("forgot.sentBody")}</p>
          <Link href={href("/login")} className="text-primary block text-sm font-semibold">
            {t("auth.signIn")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("forgot.title")} subtitle={t("forgot.subtitle", { name: siteName })}>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <AlertBanner variant="error" message={error} />}
        <input
          className={fieldClass}
          type="email"
          required
          dir="ltr"
          autoComplete="email"
          placeholder={t("auth.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || email.trim() === ""}
          className="bg-primary text-primary-foreground inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Mail className="size-4" aria-hidden />
          )}
          {t("forgot.send")}
        </button>
        <Link
          href={href("/login")}
          className="text-muted-foreground block text-center text-sm hover:underline"
        >
          {t("forgot.backToSignIn")}
        </Link>
      </form>
    </AuthShell>
  );
}
