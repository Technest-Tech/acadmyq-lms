"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AuthForm, AuthShell, type AuthMode } from "@/components/learn/auth-forms";
import { useLearn } from "@/components/learn/context";

/** Same shell as `/login`, opened on the registration side (docs/lms/09). */
export default function RegisterPage() {
  const t = useTranslations("learn");
  const router = useRouter();
  const { academy, siteName, refresh } = useLearn();
  const [mode, setMode] = useState<AuthMode>("register");

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
