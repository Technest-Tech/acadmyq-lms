"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { LessonsBoard } from "@/components/groups/board/lessons-board";

/** Client gate (`group.read`); the API enforces it for real, and scopes a TEACHER to their own groups. */
export function LessonsBoardScreen() {
  const t = useTranslations("groups");
  const { can } = useAuth();

  if (!can("group.read")) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }

  return <LessonsBoard />;
}
