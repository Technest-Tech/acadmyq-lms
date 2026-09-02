"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { PackagesManager } from "@/components/packages/packages-manager";

/**
 * Client gate for the Packages screen: rendered only when the session grants `package.read`.
 * UX gate only — the server Gate::authorize on every endpoint is the real control.
 */
export function PackagesScreen() {
  const t = useTranslations("packages");
  const { can } = useAuth();

  if (!can("package.read")) {
    return <p className="text-muted-foreground text-sm">{t("forbidden")}</p>;
  }

  return <PackagesManager />;
}
