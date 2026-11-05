"use client";

import { BellRing, BookOpen, CalendarOff, ClipboardList, DatabaseBackup, MessageCircle, ScrollText, Settings, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { HolidaysManager } from "@/components/holidays/holidays-manager";
import { AbsenceAlertManager } from "@/components/settings/absence-alert-manager";
import { AcademyNameCard } from "@/components/settings/academy-name-card";
import { AdminsCard } from "@/components/settings/admins-card";
import { ControlsManager } from "@/components/settings/controls-manager";
import { DataExportCard } from "@/components/settings/data-export-card";
import { GroupDefaultsManager } from "@/components/settings/group-defaults-manager";
import { LessonRemindersManager } from "@/components/settings/lesson-reminders-manager";
import { LessonReportManager } from "@/components/settings/lesson-report-manager";
import { LevelsManager } from "@/components/settings/levels-manager";
import { ReportCardManager } from "@/components/settings/report-card-manager";
import { RoomsManager } from "@/components/settings/rooms-manager";
import { SpecializationsManager } from "@/components/settings/specializations-manager";
import { WhatsAppManager } from "@/components/settings/whatsapp-manager";
import { useCapability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

type TabKey = "courses" | "lessonReport" | "reportCard" | "whatsapp" | "lessonReminders" | "holidays" | "controls" | "account";

/**
 * Each tab names the capability it needs: the course list and the report card are day-to-day
 * (a supervisor keeps them), the WhatsApp pairing and the Controls switches are the academy's own
 * settings (settings.manage, the owner's). Account & data (other admins, the data export) is for
 * the academy's admins only — no delegated role reaches it, whatever it holds. Lesson reminders are
 * for whoever edits students, since assigning a family's group is day-to-day work.
 */
const TABS: ReadonlyArray<{ key: TabKey; icon: LucideIcon; permission: string }> = [
  { key: "courses", icon: BookOpen, permission: "specialization.manage" },
  { key: "lessonReport", icon: ClipboardList, permission: "report_field.manage" },
  { key: "reportCard", icon: ScrollText, permission: "report_field.manage" },
  { key: "whatsapp", icon: MessageCircle, permission: "settings.manage" },
  { key: "lessonReminders", icon: BellRing, permission: "student.update" },
  // A centre's closed days (docs/centre-profile, Phase 2 §3) — its own settings, centre only.
  { key: "holidays", icon: CalendarOff, permission: "settings.manage" },
  { key: "controls", icon: SlidersHorizontal, permission: "settings.manage" },
  { key: "account", icon: DatabaseBackup, permission: "settings.manage" },
];

/** The Settings container: academy configuration, organized into top tabs. */
export function SettingsManager() {
  const t = useTranslations("settings");
  const tHolidays = useTranslations("holidays");
  const { can, session } = useAuth();
  const isAdmin = session?.role === "ACADEMY_OWNER" || (session?.role === "SUPER_ADMIN" && session.academyId !== null);
  const [chosen, setChosen] = useState<TabKey>("courses");
  // The report card is a per-client feature; without it the tab (and its template) do not exist.
  const hasReportCard = useCapability("report_card");
  // The academy's own lesson-report form and message — switched on per client by a Super Admin
  // (opt-in, so strict: no capability list means off).
  const hasLessonReport = session?.capabilities?.includes("lesson_report") ?? false;
  // Only clients with the WhatsApp module have a number to link.
  const hasWhatsApp = useCapability("whatsapp.automation");
  // A learning centre keeps a list of levels / grades next to its courses.
  const hasCentre = useCapability("centre");
  // Reminders in WhatsApp groups — switched on per client by a Super Admin (opt-in, so strict).
  const hasLessonReminders = session?.capabilities?.includes("whatsapp.group_reminders") ?? false;
  const isCentre = useCapability("centre");
  // A centre's absence alert rides the WhatsApp tab: it is a WhatsApp send, and it needs the number
  // linked there. Opt-in (`centre`), so strict, and the groups it reads must be on.
  const hasGroups = useCapability("groups");
  const hasAbsenceAlert = (session?.capabilities?.includes("centre") ?? false) && hasGroups;
  const tabs = TABS.filter(
    (tab) =>
      can(tab.permission) &&
      (tab.key !== "reportCard" || hasReportCard) &&
      (tab.key !== "lessonReport" || hasLessonReport) &&
      (tab.key !== "whatsapp" || hasWhatsApp) &&
      (tab.key !== "lessonReminders" || hasLessonReminders) &&
      (tab.key !== "holidays" || isCentre) &&
      (tab.key !== "account" || isAdmin),
  );
  const active: TabKey = tabs.some((tab) => tab.key === chosen) ? chosen : (tabs[0]?.key ?? "courses");
  // The holidays tab names itself from its own namespace (one namespace per feature).
  const tabLabel = (key: TabKey) => (key === "holidays" ? tHolidays("tab") : t(`tabs.${key}`));
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
              <span>{tabLabel(key)}</span>
            </button>
          );
        })}
      </div>

      {/* ── Tab panels ────────────────────────────────────────────────────── */}
      <div role="tabpanel" aria-label={tabLabel(active)}>
        {active === "courses" && (
          <div className="space-y-6">
            <SpecializationsManager />
            {/* A centre's levels / grades sit under the same catalogue tab (docs/centre-profile, Phase 2.1). */}
            {hasCentre && <LevelsManager />}
            {/* …and its rooms, which groups pick and the timetable filters by (02-COHERENCE-AUDIT §3). */}
            {hasCentre && <RoomsManager />}
            {/* …and what its new groups open on. */}
            {hasCentre && <GroupDefaultsManager />}
          </div>
        )}
        {active === "lessonReport" && <LessonReportManager />}
        {active === "reportCard" && <ReportCardManager />}
        {active === "whatsapp" && (
          <div className="space-y-6">
            <WhatsAppManager />
            {hasAbsenceAlert && <AbsenceAlertManager />}
          </div>
        )}
        {active === "lessonReminders" && <LessonRemindersManager />}
        {active === "holidays" && <HolidaysManager />}
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
