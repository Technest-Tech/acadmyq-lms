"use client";

import { BookOpen, DatabaseBackup, MessageCircle, ScrollText, Settings, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AcademyNameCard } from "@/components/settings/academy-name-card";
import { AdminsCard } from "@/components/settings/admins-card";
import { ControlsManager } from "@/components/settings/controls-manager";
import { DataExportCard } from "@/components/settings/data-export-card";
import { ReportCardManager } from "@/components/settings/report-card-manager";
import { SpecializationsManager } from "@/components/settings/specializations-manager";
import { WhatsAppManager } from "@/components/settings/whatsapp-manager";
import { useCapability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

type TabKey = "courses" | "reportCard" | "whatsapp" | "controls" | "account";

/**
 * Each tab names the capability it needs: the course list and the report card are day-to-day
 * (a supervisor keeps them), the WhatsApp pairing and the Controls switches are the academy's own
 * settings (settings.manage, the owner's). Account & data (other admins, the data export) is for
 * the academy's admins only — no delegated role reaches it, whatever it holds.
 */
const TABS: ReadonlyArray<{ key: TabKey; icon: LucideIcon; permission: string }> = [
  { key: "courses", icon: BookOpen, permission: "specialization.manage" },
  { key: "reportCard", icon: ScrollText, permission: "report_field.manage" },
  { key: "whatsapp", icon: MessageCircle, permission: "settings.manage" },
  { key: "controls", icon: SlidersHorizontal, permission: "settings.manage" },
  { key: "account", icon: DatabaseBackup, permission: "settings.manage" },
];

/** The Settings container: academy configuration, organized into top tabs. */
export function SettingsManager() {
  const t = useTranslations("settings");
  const { can, session } = useAuth();
  const isAdmin = session?.role === "ACADEMY_OWNER" || (session?.role === "SUPER_ADMIN" && session.academyId !== null);
  const [chosen, setChosen] = useState<TabKey>("courses");
  // The report card is a per-client feature; without it the tab (and its template) do not exist.
  const hasReportCard = useCapability("report_card");
  // Only clients with the WhatsApp module have a number to link.
  const hasWhatsApp = useCapability("whatsapp.automation");
  const tabs = TABS.filter(
    (tab) =>
      can(tab.permission) &&
      (tab.key !== "reportCard" || hasReportCard) &&
      (tab.key !== "whatsapp" || hasWhatsApp) &&
      (tab.key !== "account" || isAdmin),
  );
  const active: TabKey = tabs.some((tab) => tab.key === chosen) ? chosen : (tabs[0]?.key ?? "courses");
  const setActive = setChosen;

  return (
    <div className="w-full space-y-6">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/30">
          <Settings className="size-6 text-white" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
        </div>
      </div>

      {/* ── Academy name (above tabs) — renaming the academy is settings.manage ── */}
      {can("settings.manage") && <AcademyNameCard />}

      {/* ── Segmented top tabs ────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label={t("title")}
        className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl border bg-muted/40 p-1.5 shadow-sm"
      >
        {tabs.map(({ key, icon: Icon }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(key)}
              data-testid={`settings-tab-${key}`}
              className={cn(
                "flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all sm:px-4",
                selected
                  ? "bg-card text-foreground shadow-sm ring-1 ring-black/5"
                  : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span>{t(`tabs.${key}`)}</span>
            </button>
          );
        })}
      </div>

      {/* ── Tab panels ────────────────────────────────────────────────────── */}
      <div role="tabpanel" aria-label={t(`tabs.${active}`)}>
        {active === "courses" && <SpecializationsManager />}
        {active === "reportCard" && <ReportCardManager />}
        {active === "whatsapp" && <WhatsAppManager />}
        {active === "controls" && <ControlsManager />}
        {active === "account" && (
          <div className="space-y-6">
            <AdminsCard />
            <DataExportCard />
          </div>
        )}
      </div>
    </div>
  );
}
