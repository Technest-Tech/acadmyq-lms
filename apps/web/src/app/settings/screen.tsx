"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { SettingsManager } from "@/components/settings/settings-manager";

/** Client gate for the Settings screen (specialization.manage). The API is the real control. */
export function SettingsScreen() {
  const t = useTranslations("settings");
  const { can } = useAuth();

  if (!can("specialization.manage")) {
    return <p className="text-muted-foreground text-sm">{t("forbidden")}</p>;
  }

  return <SettingsManager />;
}
