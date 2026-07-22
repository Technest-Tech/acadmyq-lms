"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { CoursesManager } from "@/components/courses/courses-manager";

/** The Courses (LMS) page. RBAC gate only — the plan gate renders as the nav lock + a 402 server-side. */
export function CoursesScreen() {
  const t = useTranslations("courses");
  const { can } = useAuth();

  if (!can("course.read")) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>
    );
  }

  return <CoursesManager />;
}
