"use client";

import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { AbsenceAlertManager } from "@/components/settings/absence-alert-manager";
import { LessonRemindersManager } from "@/components/settings/lesson-reminders-manager";
import { WhatsAppManager } from "@/components/settings/whatsapp-manager";
import { useCapability } from "@/lib/capabilities";

/**
 * The academy's WhatsApp page: link the number by QR, then — once a Super Admin switched the
 * reminders on for this client (`whatsapp.group_reminders`, opt-in) — choose how lesson reminders
 * travel and to whom, and launch them. One place for everything the academy's number does, for a
 * Quran academy and a centre alike.
 *
 * The number is the owner's (settings.manage); assigning a family's group is day-to-day work, so
 * whoever edits students reaches the reminders without the rest.
 */
export function WhatsAppPage() {
  const t = useTranslations("whatsappPage");
  const { can, session } = useAuth();
  const hasWhatsApp = useCapability("whatsapp.automation");
  // Opt-in, so strict: no capability list means off.
  const hasReminders = session?.capabilities?.includes("whatsapp.group_reminders") ?? false;
  const hasGroups = useCapability("groups");
  const hasAbsenceAlert = (session?.capabilities?.includes("centre") ?? false) && hasGroups;
  const owner = can("settings.manage");
  const assigns = can("student.update") || can("teacher.update") || can("group.manage");

  // Bumped when the number links or drops, so the reminders' readiness list follows at once. The
  // first state heard is the one the reminders already loaded with, so it is not a change.
  const [connectionVersion, setConnectionVersion] = useState(0);
  const lastState = useRef<string | null>(null);
  const onStateChange = useCallback((state: string) => {
    const before = lastState.current;
    lastState.current = state;
    if (before !== null && before !== state) setConnectionVersion((v) => v + 1);
  }, []);

  if (!hasWhatsApp || (!owner && !(hasReminders && assigns))) {
    return <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>;
  }

  // Steps are numbered by what this person sees, so a supervisor's list starts at 1.
  const steps = [owner && "number", hasReminders && "reminders", owner && hasAbsenceAlert && "absence"].filter(Boolean);
  const n = (key: string) => steps.indexOf(key) + 1;

  return (
    <div className="w-full space-y-6" data-testid="whatsapp-page">
      <div className="flex items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 shadow-lg shadow-emerald-500/30">
          <MessageCircle className="size-6 text-white" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{hasReminders ? t("subtitle") : t("subtitleNumberOnly")}</p>
        </div>
      </div>

      {owner && (
        <Step n={n("number")} title={t("stepNumber")}>
          <WhatsAppManager onStateChange={onStateChange} />
        </Step>
      )}

      {hasReminders && (
        <Step n={n("reminders")} title={t("stepReminders")}>
          <LessonRemindersManager connectionVersion={connectionVersion} />
        </Step>
      )}

      {owner && hasAbsenceAlert && (
        <Step n={n("absence")} title={t("stepAbsence")}>
          <AbsenceAlertManager />
        </Step>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
