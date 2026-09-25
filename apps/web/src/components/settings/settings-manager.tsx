"use client";

import { BookOpen, ScrollText, Settings, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AcademyNameCard } from "@/components/settings/academy-name-card";
import { ControlsManager } from "@/components/settings/controls-manager";
import { ReportCardManager } from "@/components/settings/report-card-manager";
import { SpecializationsManager } from "@/components/settings/specializations-manager";
import { useCapability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

type TabKey = "courses" | "reportCard" | "controls";

const TABS: ReadonlyArray<{ key: TabKey; icon: LucideIcon }> = [
  { key: "courses", icon: BookOpen },
  { key: "reportCard", icon: ScrollText },
  { key: "controls", icon: SlidersHorizontal },
];

/** The Settings container: academy configuration, organized into top tabs. */
export function SettingsManager() {
  const t = useTranslations("settings");
  const [chosen, setChosen] = useState<TabKey>("courses");
  // The report card is a per-client feature; without it the tab (and its template) do not exist.
  const hasReportCard = useCapability("report_card");
  const tabs = hasReportCard ? TABS : TABS.filter((tab) => tab.key !== "reportCard");
  const active: TabKey = tabs.some((tab) => tab.key === chosen) ? chosen : "courses";
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

      {/* ── Academy name (always visible, above tabs) ────────────────────── */}
      <AcademyNameCard />

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
        {active === "controls" && <ControlsManager />}
      </div>
    </div>
  );
}
