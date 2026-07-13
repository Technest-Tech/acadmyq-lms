"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { GuardianManager } from "@/components/guardians/guardian-manager";

/** Client gate for the Guardians screen (guardian.read). The API is the real control. */
export function GuardiansScreen() {
  const t = useTranslations("guardians");
  const { can } = useAuth();

  if (!can("guardian.read")) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return <GuardianManager />;
}
