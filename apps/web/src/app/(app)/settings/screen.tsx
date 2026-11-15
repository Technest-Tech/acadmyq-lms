"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { SettingsManager } from "@/components/settings/settings-manager";

/**
 * Client gate for the Settings screen: the course list (specialization.manage), the academy's
 * own switches (settings.manage) or its payment methods (payment_settings.manage) — each tab
 * checks its own part. The API is the real control.
 */
export function SettingsScreen() {
  const t = useTranslations("settings");
  const { can } = useAuth();

  if (!can("specialization.manage") && !can("settings.manage") && !can("payment_settings.manage")) {
    return <p className="text-muted-foreground text-sm">{t("forbidden")}</p>;
  }

  return <SettingsManager />;
}
