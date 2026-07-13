"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { TeacherManager } from "@/components/teachers/teacher-manager";

/** Client gate for the Teachers screen (teacher.read). The API is the real control. */
export function TeachersScreen() {
  const t = useTranslations("teachers");
  const { can } = useAuth();

  if (!can("teacher.read")) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return <TeacherManager />;
}
