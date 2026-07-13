"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { TeacherWorkspace } from "@/components/teachers/teacher-workspace";

/** Client gate for the teacher workspace (teacher.read). The API is the real control. */
export function TeacherDetailScreen() {
  const t = useTranslations("teachers");
  const { can } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  if (!can("teacher.read")) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }
  if (!id) return null;

  return <TeacherWorkspace teacherId={id} />;
}
