"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
  const params = useSearchParams();
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
          // `?next=` is how a course page hands the visitor over: they land back on the course
          // they were buying, not on a library that is still empty. Same-site paths only — an
          // open redirect on a sign-in page is how phishing links get built.
          router.push(safeNext(params.get("next"), academy));
        }}
      />
    </AuthShell>
  );
}

/** A `next` the caller supplied, if it is a path on this site; otherwise "my learning". */
function safeNext(next: string | null, academy: string): string {
  const fallback = `/learn/${academy}/me`;
  if (next === null || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
