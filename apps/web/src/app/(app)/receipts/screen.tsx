"use client";

import { useTranslations } from "next-intl";
import { ReceiptsRegister } from "@/components/accounting/receipts-register";
import { useAuth } from "@/components/auth-provider";
import { useCapability } from "@/lib/capabilities";

/** Client gates (`invoice.read` + the `accounting` switch); the API enforces both for real. */
export function ReceiptsScreen() {
  const t = useTranslations("accounting");
  const { can } = useAuth();
  const accounting = useCapability("accounting");

  if (!can("invoice.read") || !accounting) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }

  return <ReceiptsRegister />;
}
