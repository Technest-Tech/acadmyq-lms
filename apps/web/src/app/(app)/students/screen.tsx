"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { StudentManager } from "@/components/students/student-manager";

/**
 * Client gate for the Students screen: rendered only when the session grants `student.read`.
 * UX gate only — the server Gate::authorize on every endpoint is the real control, and a
 * Teacher's list is additionally row-scoped to their own students server-side.
 */
export function StudentsScreen() {
  const t = useTranslations("students");
  const { can } = useAuth();

  if (!can("student.read")) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return <StudentManager />;
}
