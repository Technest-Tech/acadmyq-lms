"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { TrialsManager } from "@/components/trials/trials-manager";

/**
 * Client gate for the Free Trials screen: rendered only when the session grants `trial.read`.
 * UX gate only — the server Gate::authorize on every endpoint is the real control.
 */
export function TrialsScreen() {
  const t = useTranslations("trials");
  const { can } = useAuth();

  if (!can("trial.read")) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return <TrialsManager />;
}
