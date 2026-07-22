"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { CrmManager } from "@/components/crm/crm-manager";

/** The CRM / Leads page. RBAC gate only — the plan gate renders as the nav lock + a 402 server-side. */
export function CrmScreen() {
  const t = useTranslations("crm");
  const { can } = useAuth();

  if (!can("crm.read")) {
    return <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>;
  }

  return <CrmManager />;
}
