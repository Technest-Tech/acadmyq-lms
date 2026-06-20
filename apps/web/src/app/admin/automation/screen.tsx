"use client";

import { Activity, BookOpen, LayoutGrid, MessageCircle, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { OverviewTab } from "./overview-tab";
import { ActivityTab } from "./activity-tab";
import { GuideTab } from "./guide-tab";

type Tab = "overview" | "activity" | "guide";

const TABS: Array<{ key: Tab; icon: LucideIcon }> = [
  { key: "overview", icon: LayoutGrid },
  { key: "activity", icon: Activity },
  { key: "guide", icon: BookOpen },
];

export function AutomationOverviewScreen() {
  const t = useTranslations("adminAutomation");
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  if (!can("automation.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <MessageCircle className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="-mb-px flex gap-1">
          {TABS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                tab === key ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(`tabs.${key}`)}
            </button>
          ))}
        </nav>
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "guide" && <GuideTab />}
    </div>
  );
}
