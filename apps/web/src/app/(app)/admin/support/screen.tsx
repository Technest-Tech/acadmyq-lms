"use client";

import { useTranslations } from "next-intl";
import { AdminPageHeader } from "@/components/admin/page-header";
import { useAuth } from "@/components/auth-provider";
import { SupportInbox } from "@/components/support/support-inbox";

export function AdminSupportScreen() {
  const t = useTranslations("adminSupport");
  const { can } = useAuth();

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return (
    <div className="space-y-5" data-testid="admin-support">
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />
      <SupportInbox />
    </div>
  );
}
