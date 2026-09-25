"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { TeacherInsights } from "@/components/teacher-insights/teacher-insights";

/**
 * Teacher performance (was Teacher Quality — the route keeps its address so bookmarks and the
 * sidebar key survive). RBAC gate only — the plan gate renders as the nav lock + a 402 server-side.
 */
export function TeacherQualityScreen() {
  const t = useTranslations("teacherInsights");
  const { can } = useAuth();

  if (!can("teacher_quality.read")) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>
    );
  }

  return <TeacherInsights />;
}
