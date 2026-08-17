"use client";

import { Activity, BookOpen, LayoutGrid, Server, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { OverviewTab } from "./overview-tab";
import { ActivityTab } from "./activity-tab";
import { SystemTab } from "./system-tab";
import { GuideTab } from "./guide-tab";

// R4 (client-first redesign): WhatsApp Ops is platform-wide monitoring only — connection, keys
// and toggles are managed on each client's WhatsApp tab, so the per-client API-clients tab is gone.
type Tab = "overview" | "activity" | "system" | "guide";

const TABS: Array<{ key: Tab; icon: LucideIcon }> = [
  { key: "overview", icon: LayoutGrid },
  { key: "activity", icon: Activity },
  { key: "system", icon: Server },
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
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-1" role="tablist">
          {TABS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors",
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
      {tab === "system" && <SystemTab />}
      {tab === "guide" && <GuideTab />}
    </div>
  );
}
