"use client";

import { BookOpen, CreditCard, ImageIcon, Palette, Settings, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AcademyNameCard } from "@/components/settings/academy-name-card";
import { ColorsManager } from "@/components/settings/colors-manager";
import { LogoManager } from "@/components/settings/logo-manager";
import { PaymentSettingsManager } from "@/components/settings/payment-settings-manager";
import { SpecializationsManager } from "@/components/settings/specializations-manager";
import { cn } from "@/lib/utils";

type TabKey = "courses" | "logo" | "colors" | "payment";

const TABS: ReadonlyArray<{ key: TabKey; icon: LucideIcon }> = [
  { key: "courses", icon: BookOpen },
  { key: "logo", icon: ImageIcon },
  { key: "colors", icon: Palette },
  { key: "payment", icon: CreditCard },
];

/** The Settings container: academy configuration, organized into three top tabs. */
export function SettingsManager() {
  const t = useTranslations("settings");
  const [active, setActive] = useState<TabKey>("courses");

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
        className="flex gap-1 rounded-2xl border bg-muted/40 p-1.5 shadow-sm"
      >
        {TABS.map(({ key, icon: Icon }) => {
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
                "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
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
        {active === "logo" && <LogoManager />}
        {active === "colors" && <ColorsManager />}
        {active === "payment" && <PaymentSettingsManager />}
      </div>
    </div>
  );
}
