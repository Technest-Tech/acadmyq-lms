"use client";

import { useTranslations } from "next-intl";
import { AdjustmentsManager } from "@/components/adjustments/adjustments-manager";
import { useAuth } from "@/components/auth-provider";

/**
 * The Discounts & Awards page. Gated on `payout.read` — the rows ARE payout adjustments, so
 * reading them here must require what reading them on the statement requires.
 */
export function DiscountsAwardsScreen() {
  const t = useTranslations("adjustments");
  const { can } = useAuth();

  if (!can("payout.read")) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>
    );
  }

  return <AdjustmentsManager />;
}
