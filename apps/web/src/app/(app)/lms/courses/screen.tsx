"use client";

import { BookOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { CoursesManager } from "@/components/courses/courses-manager";
import { EmptyState } from "@/components/courses/lms-ui";

/** The Courses page of the LMS workspace. RBAC gate only — the plan gate renders as the nav lock + a 402 server-side. */
export function CoursesScreen() {
  const t = useTranslations("courses");
  const { can } = useAuth();

  if (!can("course.read")) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState Icon={BookOpen} color="slate" title={t("noAccess")} />
      </div>
    );
  }

  return <CoursesManager />;
}
