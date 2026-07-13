"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { StaffManager } from "@/components/staff/staff-manager";

export function StaffScreen() {
  const t = useTranslations("staff");
  const { can } = useAuth();

  if (!can("staff.read")) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t("empty")}
      </p>
    );
  }

  return <StaffManager />;
}
