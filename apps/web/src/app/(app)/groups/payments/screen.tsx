"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { PaymentsBoard } from "@/components/groups/board/payments-board";

/** Client gate (`invoice.read`); the API enforces it for real, and scopes a TEACHER to their own groups. */
export function PaymentsBoardScreen() {
  const t = useTranslations("groups");
  const { can } = useAuth();

  if (!can("invoice.read")) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }

  return <PaymentsBoard />;
}
