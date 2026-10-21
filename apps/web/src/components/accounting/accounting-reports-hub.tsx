"use client";

import { BarChart3, CalendarDays, Layers, Scale } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountingDailyScreen } from "@/components/accounting/accounting-daily";
import { AccountingGroupsScreen } from "@/components/accounting/accounting-groups";
import { AccountingIncomeScreen } from "@/components/accounting/accounting-income";
import { AccountingTabs } from "@/components/accounting/accounting-ui";
import { PageHero } from "@/components/ui/page-hero";
import { useCapability } from "@/lib/capabilities";

type Tab = "daily" | "income" | "groups";

/**
 * The accounting reports (docs/groups/01-ACCOUNTING.md), one page with tabs: collections day by
 * day, income against expenses for the year, and — for a client with group classes — every
 * group's collection and what it left. They read; nothing is recorded from here.
 */
export function AccountingReportsHub() {
  const t = useTranslations("accounting");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const groups = useCapability("groups");
  const tabs: Tab[] = groups ? ["daily", "income", "groups"] : ["daily", "income"];
  const initial = search.get("tab");
  const [tab, setTab] = useState<Tab>(tabs.includes(initial as Tab) ? (initial as Tab) : "daily");

  const pick = (key: Tab) => {
    setTab(key);
    router.replace(`${pathname}?tab=${key}`, { scroll: false });
  };

  const icons = { daily: CalendarDays, income: Scale, groups: Layers } as const;

  return (
    <div className="space-y-5" data-testid="accounting-reports-hub">
      <PageHero icon={BarChart3} title={t("hub.reports.title")} subtitle={t("hub.reports.subtitle")} latticeId="accounting-reports-hero" />
      <AccountingTabs tabs={tabs.map((key) => ({ key, label: t(`hub.reports.tabs.${key}`), icon: icons[key] }))} value={tab} onChange={pick} testIdPrefix="reports-tab" />
      {tab === "daily" && <AccountingDailyScreen hero={false} />}
      {tab === "income" && <AccountingIncomeScreen hero={false} />}
      {tab === "groups" && groups && <AccountingGroupsScreen hero={false} />}
    </div>
  );
}
