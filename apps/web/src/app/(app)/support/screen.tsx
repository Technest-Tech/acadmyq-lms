"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { SupportPage } from "@/components/support/support-page";

/** Client gate for the Support page (support.manage). */
export function SupportScreen() {
  const t = useTranslations("support");
  const { can } = useAuth();

  if (!can("support.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return <SupportPage />;
}
