"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { SupervisionStats } from "@/components/supervision/supervision-stats";

/** The Supervision statistics page. RBAC gate only — the server enforces `supervision.stats`. */
export function SupervisionScreen() {
  const t = useTranslations("supervision");
  const { can } = useAuth();

  if (!can("supervision.stats")) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>
    );
  }

  return <SupervisionStats />;
}
