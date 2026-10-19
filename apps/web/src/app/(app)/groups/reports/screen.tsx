"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { ReportsBoard } from "@/components/groups/board/reports-board";

/** Client gate (`group.read`); the API enforces it for real, and scopes a TEACHER to their own groups. */
export function ReportsBoardScreen() {
  const t = useTranslations("groups");
  const { can } = useAuth();

  if (!can("group.read")) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }

  return <ReportsBoard />;
}
