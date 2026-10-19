"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { GroupsManager } from "@/components/groups/groups-manager";

/**
 * Client gate for the Groups screen: rendered only when the session grants `group.read`.
 * UX gate only — the server Gate::authorize on every endpoint is the real control.
 */
export function GroupsScreen() {
  const t = useTranslations("groups");
  const { can } = useAuth();

  if (!can("group.read")) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }

  return <GroupsManager />;
}
