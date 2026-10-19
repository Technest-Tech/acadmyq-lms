"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { StudentsBoard } from "@/components/groups/board/students-board";

/** Client gate (`group.read`); the API enforces it for real, and scopes a TEACHER to their own groups. */
export function StudentsBoardScreen() {
  const t = useTranslations("groups");
  const { can } = useAuth();

  if (!can("group.read")) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }

  return <StudentsBoard />;
}
