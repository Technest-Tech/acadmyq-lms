import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { HealthStatus } from "@/components/health-status";

export default async function Home() {
  const t = await getTranslations("nav");

  return (
    <AppShell>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("dashboard")}</h1>
        <HealthStatus />
      </div>
    </AppShell>
  );
}
