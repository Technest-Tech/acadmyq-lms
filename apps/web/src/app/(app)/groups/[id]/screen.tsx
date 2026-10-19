"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { GroupDetailScreen } from "@/components/groups/group-detail";

/** Client gate for a group's page (group.read); the API row-scopes a TEACHER to their own groups. */
export function GroupScreen({ groupId }: { groupId: string }) {
  const t = useTranslations("groups");
  const { can } = useAuth();

  if (!can("group.read")) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }

  return <GroupDetailScreen groupId={groupId} />;
}
