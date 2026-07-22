"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { QualityManager } from "@/components/quality/quality-manager";

/** The Teacher Quality page. RBAC gate only — the plan gate renders as the nav lock + a 402 server-side. */
export function TeacherQualityScreen() {
  const t = useTranslations("quality");
  const { can } = useAuth();

  if (!can("teacher_quality.read")) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>
    );
  }

  return <QualityManager />;
}
