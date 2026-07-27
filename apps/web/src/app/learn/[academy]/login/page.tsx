"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AuthForm, AuthShell, type AuthMode } from "@/components/learn/auth-forms";
import { useLearn } from "@/components/learn/context";

/**
 * The linkable sign-in page (docs/lms/09). The header's modal covers the in-flow case; this exists
 * because "sign in at <site>/login" is what a teacher writes on a handout, and because a session
 * that expires mid-visit needs somewhere to land.
 */
export default function LoginPage() {
  const t = useTranslations("learn");
  const router = useRouter();
  const { academy, siteName, refresh } = useLearn();
  const [mode, setMode] = useState<AuthMode>("login");

  return (
    <AuthShell
      title={mode === "login" ? t("auth.signIn") : t("auth.register")}
      subtitle={t("auth.subtitle", { name: siteName })}
    >
      <AuthForm
        academy={academy}
        mode={mode}
        onModeChange={setMode}
        onDone={async () => {
          await refresh();
          router.push(`/learn/${academy}/me`);
        }}
      />
    </AuthShell>
  );
}
