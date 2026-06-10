import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { HealthStatus } from "@/components/health-status";

/**
 * The authenticated landing. The AuthProvider resolves the session client-side and the
 * AppShell renders the role-appropriate layout (or redirects to /login). Role-specific
 * landing destinations (platform view / dashboard / schedule) arrive in Sprints 3+; for
 * now every role lands on this real, empty dashboard inside the shell.
 */
export default async function Home() {
  const t = await getTranslations("nav");

  return (
    <AuthProvider>
      <AppShell>
        <div className="space-y-6">
          <h1 className="text-2xl font-semibold">{t("dashboard")}</h1>
          <HealthStatus />
        </div>
      </AppShell>
    </AuthProvider>
  );
}
