"use client";

import { useTranslations } from "next-intl";
import { AttendanceManager } from "@/components/attendance/attendance-manager";
import { useAuth } from "@/components/auth-provider";

/**
 * Client gate for the Attendance screen: rendered only when the session grants `session.read`.
 * The API enforces the real boundary (a Teacher only ever sees their own sessions); this is the
 * UX gate.
 */
export function AttendanceScreen() {
  const t = useTranslations("attendance");
  const { can } = useAuth();

  if (!can("session.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return <AttendanceManager />;
}
