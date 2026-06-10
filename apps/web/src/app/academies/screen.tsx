"use client";

import { useTranslations } from "next-intl";
import { AcademyManager } from "@/components/academies/academy-manager";
import { useAuth } from "@/components/auth-provider";

/**
 * Client gate for the academy-management screen: rendered only when the resolved session
 * grants `academy.read` (Super Admin). A hidden screen is UX, not security — the server
 * Gate::authorize on every endpoint is the real control.
 */
export function AcademiesScreen() {
  const t = useTranslations("academies");
  const { can } = useAuth();

  if (!can("academy.read")) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return <AcademyManager />;
}
