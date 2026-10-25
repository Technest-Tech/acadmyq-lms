"use client";

import { Landmark, Percent, Receipt, TrendingDown, Vault } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountingExpensesScreen } from "@/components/accounting/accounting-expenses";
import { DiscountPresetsScreen } from "@/components/accounting/discount-presets";
import { AccountingTreasuryScreen } from "@/components/accounting/accounting-treasury";
import { AccountingTabs } from "@/components/accounting/accounting-ui";
import { ReceiptsRegister } from "@/components/accounting/receipts-register";
import { PageHero } from "@/components/ui/page-hero";

type Tab = "accounts" | "receipts" | "expenses" | "discounts";
const TABS: Tab[] = ["accounts", "receipts", "expenses", "discounts"];

/**
 * The money's movement, on one page (docs/groups/01-ACCOUNTING.md): where it sits (the accounts),
 * what came in (the receipts) and what went out (the expenses). Three sidebar pages became three
 * tabs, because an accountant asks these questions together — and an expense cannot even be
 * recorded without an account to pay it from. The fourth tab holds the discount presets (بنود الخصم)
 * the family card offers.
 */
export function AccountingTreasuryHub() {
  const t = useTranslations("accounting");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const initial = search.get("tab");
  const [tab, setTab] = useState<Tab>(TABS.includes(initial as Tab) ? (initial as Tab) : "accounts");

  const pick = (key: Tab) => {
    setTab(key);
    router.replace(`${pathname}?tab=${key}`, { scroll: false });
  };

  return (
    <div className="space-y-5" data-testid="accounting-treasury-hub">
      <PageHero icon={Vault} title={t("hub.treasury.title")} subtitle={t("hub.treasury.subtitle")} latticeId="accounting-treasury-hero" />
      <AccountingTabs
        tabs={[
          { key: "accounts", label: t("hub.treasury.tabs.accounts"), icon: Landmark },
          { key: "receipts", label: t("hub.treasury.tabs.receipts"), icon: Receipt },
          { key: "expenses", label: t("hub.treasury.tabs.expenses"), icon: TrendingDown },
          { key: "discounts", label: t("hub.treasury.tabs.discounts"), icon: Percent },
        ]}
        value={tab}
        onChange={pick}
        testIdPrefix="treasury-tab"
      />
      {tab === "accounts" && <AccountingTreasuryScreen hero={false} />}
      {tab === "receipts" && <ReceiptsRegister hero={false} />}
      {tab === "expenses" && <AccountingExpensesScreen hero={false} />}
      {tab === "discounts" && <DiscountPresetsScreen />}
    </div>
  );
}
