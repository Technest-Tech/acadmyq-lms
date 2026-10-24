"use client";

import { ClipboardCheck, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountingTabs } from "@/components/accounting/accounting-ui";
import { AttendanceManager } from "@/components/attendance/attendance-manager";
import { useAuth } from "@/components/auth-provider";
import { LessonsBoard } from "@/components/groups/board/lessons-board";
import { useCapability } from "@/lib/capabilities";

type View = "private" | "groups";

/**
 * Client gate for the Attendance screen: rendered only when the session grants `session.read`.
 * The API enforces the real boundary (a Teacher only ever sees their own sessions); this is the
 * UX gate.
 *
 * A client with group classes gets the group lessons here too, as a second tab: the desk marks
 * both kinds of attendance from one place. A group lesson is its own row (never a session), so the
 * tab shows the groups' own board; an academy without `groups` sees the page exactly as before.
 */
export function AttendanceScreen() {
  const t = useTranslations("attendance");
  const { can } = useAuth();
  const groups = useCapability("groups") && can("group.read");
  const [view, setView] = useState<View>("private");

  if (!can("session.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  if (!groups) {
    return <AttendanceManager />;
  }

  const tabs = (
    <AccountingTabs<View>
      tabs={[
        { key: "private", label: t("tabs.private"), icon: ClipboardCheck },
        { key: "groups", label: t("tabs.groups"), icon: Layers },
      ]}
      value={view}
      onChange={setView}
      testIdPrefix="attendance-tab"
    />
  );

  if (view === "groups") {
    return (
      <div className="space-y-5" data-testid="attendance-groups">
        {tabs}
        <LessonsBoard />
      </div>
    );
  }

  return <AttendanceManager header={tabs} />;
}
