"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { StaffManager } from "@/components/staff/staff-manager";

/** Team & permissions: the members tab needs staff.read, the roles tab role.manage — either opens it. */
export function StaffScreen() {
  const t = useTranslations("staff");
  const { can } = useAuth();

  if (!can("staff.read") && !can("role.manage")) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t("empty")}
      </p>
    );
  }

  return <StaffManager />;
}
