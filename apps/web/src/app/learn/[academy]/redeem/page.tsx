"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AuthForm, AuthShell, RedeemForm, type AuthMode } from "@/components/learn/auth-forms";
import { useLearn } from "@/components/learn/context";

/**
 * The standalone redemption page (docs/lms/09) — the single link a client can print on a card, put
 * in a WhatsApp broadcast or read out in class. Redeeming needs an account, so an anonymous visitor
 * gets the auth form first and lands back on the code entry the moment they are in; no second
 * navigation, no lost code.
 */
export default function RedeemPage() {
  const t = useTranslations("learn");
  const router = useRouter();
  const { academy, siteName, learner, loading, refresh } = useLearn();
  const [mode, setMode] = useState<AuthMode>("login");

  if (loading) {
    return (
      <AuthShell title={t("redeem.title")}>
        <div className="space-y-3" aria-hidden>
          <div className="bg-muted h-11 animate-pulse rounded-xl" />
          <div className="bg-muted h-11 animate-pulse rounded-xl" />
        </div>
      </AuthShell>
    );
  }

  if (!learner) {
    return (
      <AuthShell title={t("redeem.title")} subtitle={t("redeem.signInFirst")}>
        <AuthForm
          academy={academy}
          mode={mode}
          onModeChange={setMode}
          onDone={() => void refresh()}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("redeem.title")} subtitle={t("auth.subtitle", { name: siteName })}>
      <RedeemForm
        academy={academy}
        doneLabel={t("redeem.done")}
        onDone={async () => {
          await refresh();
          router.push(`/learn/${academy}/me`);
        }}
      />
    </AuthShell>
  );
}
