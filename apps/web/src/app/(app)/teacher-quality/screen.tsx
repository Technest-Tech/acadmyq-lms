"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { TeacherPerformance } from "@/components/teacher-performance/teacher-performance";

/**
 * Teacher performance (was Teacher Quality — the route keeps its address so bookmarks and the
 * sidebar key survive). RBAC gate only — the plan gate renders as the nav lock + a 402 server-side.
 *
 * Opens for the owner's scorecard capability OR for whoever reads quality: the supervisor writes
 * the lesson ratings and conduct notes on this page, so it has to open for them.
 */
export function TeacherQualityScreen() {
  const t = useTranslations("teacherPerformance");
  const { can } = useAuth();

  if (!can("teacher_quality.insights") && !can("teacher_quality.read")) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>
    );
  }

  return <TeacherPerformance />;
}
